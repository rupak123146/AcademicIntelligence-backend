/**
 * 🎓 Academic Intelligence Platform - Attempt Service (SQL/Prisma)
 * Exam attempt management using MySQL
 */

const { prisma } = require('../config/database');
const { setCache, getCache, deleteCache, CacheKeys } = require('../config/redis');
const { ApiError, calculatePercentage, formatDuration } = require('../utils/helpers');
const logger = require('../utils/logger');

class AttemptService {
  async getExamWithQuestions(examId) {
    return prisma.exam.findUnique({
      where: { id: examId },
      include: {
        questions: {
          include: { question: { include: { options: true } } },
        },
      },
    });
  }

  /**
   * Start an exam attempt
   */
  async startAttempt(examId, studentId, metadata = {}) {
    const exam = await this.getExamWithQuestions(examId);
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    logger.info('Starting exam attempt:', {
      examId,
      studentId,
      examStatus: exam.status,
      examTitle: exam.title,
    });

    if (exam.status !== 'published' && exam.status !== 'active') {
      logger.warn('Exam not available:', { examId, status: exam.status });
      throw ApiError.badRequest(`Exam is not available. Current status: ${exam.status}`);
    }

    const now = new Date();
    if (exam.startTime && new Date(exam.startTime) > now) {
      const startTime = new Date(exam.startTime).toLocaleString();
      logger.warn('Exam not started:', { examId, startTime, now: now.toLocaleString() });
      throw ApiError.badRequest(`Exam has not started yet. It will begin at ${startTime}`);
    }
    if (exam.endTime && new Date(exam.endTime) < now) {
      const endTime = new Date(exam.endTime).toLocaleString();
      logger.warn('Exam ended:', { examId, endTime, now: now.toLocaleString() });
      throw ApiError.badRequest(`Exam has ended. It ended at ${endTime}`);
    }

    if (exam.courseId) {
      logger.info('Checking course enrollment:', { studentId, courseId: exam.courseId });
      const enrollment = await prisma.studentEnrollment.findFirst({
        where: { studentId, courseId: exam.courseId, status: 'enrolled' },
      });
      if (!enrollment) {
        logger.warn('Student not enrolled:', { studentId, courseId: exam.courseId });
        throw ApiError.forbidden('You are not enrolled in the course for this exam');
      }
    }

    const attemptCount = await prisma.examAttempt.count({
      where: { examId, studentId },
    });
    logger.info('Previous attempts:', { examId, studentId, attemptCount, maxAttempts: exam.maxAttempts });
    if (attemptCount >= exam.maxAttempts) {
      throw ApiError.badRequest(`Maximum attempts reached. You have already attempted this exam ${attemptCount} time(s).`);
    }

    const activeAttempt = await prisma.examAttempt.findFirst({
      where: { examId, studentId, status: { in: ['started', 'in_progress'] } },
    });
    if (activeAttempt) {
      logger.warn('Active attempt found:', { attemptId: activeAttempt.id, status: activeAttempt.status });
      throw ApiError.badRequest('You have an active attempt. Please complete or submit it first.');
    }

    const attempt = await prisma.examAttempt.create({
      data: {
        examId,
        studentId,
        attemptNumber: attemptCount + 1,
        status: 'started',
        ipAddress: metadata.ipAddress,
        browserInfo: metadata.browserInfo || {},
        maxScore: exam.totalMarks,
      },
    });

    let questions = exam.questions.map((rel) => rel.question);
    if (exam.shuffleQuestions) {
      questions = questions.sort(() => Math.random() - 0.5);
    }

    if (questions.length > 0) {
      await prisma.studentAnswer.createMany({
        data: questions.map((question) => ({
          attemptId: attempt.id,
          questionId: question.id,
          isAnswered: false,
        })),
        skipDuplicates: true,
      });
    }

    if (attemptCount === 0) {
      await prisma.exam.updateMany({
        where: { id: examId, status: 'published' },
        data: { status: 'active' },
      });
    }

    const endTime = new Date(attempt.startedAt);
    endTime.setMinutes(endTime.getMinutes() + exam.durationMinutes);

    await setCache(CacheKeys.activeAttempt(studentId, examId), {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      endTime: endTime.toISOString(),
    }, exam.durationMinutes * 60 + 300);

    await this.logActivity(attempt.id, studentId, examId, 'exam_started', null, metadata);

    logger.info('Exam attempt started:', { attemptId: attempt.id, examId, studentId });

    const formattedQuestions = questions.map((q, index) => ({
      id: q.id,
      questionNumber: index + 1,
      questionText: q.questionText,
      questionType: q.questionType,
      options: exam.shuffleOptions && q.options
        ? q.options.map((o) => ({ id: o.id, text: o.text })).sort(() => Math.random() - 0.5)
        : q.options?.map((o) => ({ id: o.id, text: o.text })),
      marks: q.marks,
      negativeMarks: q.negativeMarks,
    }));

    return {
      attempt: {
        id: attempt.id,
        startedAt: attempt.startedAt,
        status: attempt.status,
        exam: { durationMinutes: exam.durationMinutes },
      },
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      totalQuestions: questions.length,
      totalMarks: exam.totalMarks,
      negativeMarking: exam.negativeMarking,
      startedAt: attempt.startedAt,
      endTime: endTime.toISOString(),
      timeRemaining: Math.max(0, Math.floor((endTime - new Date()) / 1000)),
      questions: formattedQuestions,
    };
  }

  /**
   * Save answer
   */
  async saveAnswer(attemptId, questionId, answer, studentId, metadata = {}) {
    const attempt = await prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId, status: { in: ['started', 'in_progress'] } },
    });

    if (!attempt) {
      throw ApiError.notFound('Active attempt not found');
    }

    const exam = await prisma.exam.findUnique({ where: { id: attempt.examId } });
    const endTime = new Date(attempt.startedAt);
    endTime.setMinutes(endTime.getMinutes() + exam.durationMinutes);

    if (new Date() > endTime) {
      await this.autoSubmitAttempt(attemptId);
      throw ApiError.badRequest('Time expired. Exam has been auto-submitted.');
    }

    const existingAnswer = await prisma.studentAnswer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    const previousAnswer = existingAnswer?.selectedAnswer;

    await prisma.studentAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: {
        selectedAnswer: answer,
        isAnswered: answer !== null && answer !== undefined,
        answeredAt: new Date(),
        timeSpent: metadata.timeSpent || 0,
      },
      create: {
        attemptId,
        questionId,
        selectedAnswer: answer,
        isAnswered: answer !== null && answer !== undefined,
        answeredAt: new Date(),
        timeSpent: metadata.timeSpent || 0,
      },
    });

    if (attempt.status === 'started') {
      await prisma.examAttempt.update({
        where: { id: attemptId },
        data: { status: 'in_progress' },
      });
    }

    const eventType = previousAnswer ? 'answer_changed' : 'answer_submitted';
    await this.logActivity(attemptId, studentId, attempt.examId, eventType, questionId, {
      ...metadata,
      previousAnswer,
      newAnswer: answer,
    });

    logger.debug('Answer saved:', { attemptId, questionId });
    return { success: true };
  }

  /**
   * Submit exam attempt
   */
  async submitAttempt(attemptId, studentId) {
    const attempt = await prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId, status: { in: ['started', 'in_progress'] } },
    });

    if (!attempt) {
      throw ApiError.notFound('Active attempt not found');
    }

    return this.finalizeAttempt(attemptId, 'submitted');
  }

  /**
   * Auto-submit expired attempt
   */
  async autoSubmitAttempt(attemptId) {
    return this.finalizeAttempt(attemptId, 'auto_submitted');
  }

  /**
   * Finalize and grade attempt
   */
  async finalizeAttempt(attemptId, submitType) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || !['started', 'in_progress'].includes(attempt.status)) {
      throw ApiError.badRequest('Attempt already submitted');
    }

    const exam = await prisma.exam.findUnique({ where: { id: attempt.examId } });
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId },
      include: { question: { include: { options: true } } },
    });

    let totalScore = 0;
    let correctAnswers = 0;
    let wrongAnswers = 0;
    let skipped = 0;

    for (const answer of answers) {
      const question = answer.question;
      if (!question) continue;

      if (!answer.isAnswered || answer.selectedAnswer === null) {
        skipped++;
        await prisma.studentAnswer.update({
          where: { id: answer.id },
          data: { isCorrect: false, marksAwarded: 0 },
        });
      } else {
        const isCorrect = this.checkAnswer(question, answer.selectedAnswer);
        let marksAwarded = 0;
        if (isCorrect) {
          correctAnswers++;
          const marksValue = question.marks && question.marks > 0 ? question.marks : 1;
          marksAwarded = marksValue;
          totalScore += marksAwarded;
          logger.info(`Question answered correctly: ${question.id}, marks awarded: ${marksAwarded}`);
        } else {
          wrongAnswers++;
          if (exam.negativeMarking) {
            marksAwarded = -(question.negativeMarks || exam.negativeMarkValue || 0);
            totalScore += marksAwarded;
          }
        }

        await prisma.studentAnswer.update({
          where: { id: answer.id },
          data: { isCorrect, marksAwarded },
        });
      }
    }

    const percentage = calculatePercentage(totalScore, exam.totalMarks);
    const passed = percentage >= exam.passingPercentage;
    const grade = this.calculateGrade(percentage);

    const timeTaken = Math.floor((new Date() - new Date(attempt.startedAt)) / 1000);

    const updatedAttempt = await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: submitType === 'auto_submitted' ? 'auto_submitted' : 'submitted',
        submittedAt: new Date(),
        totalScore: Math.max(0, totalScore),
        percentage,
        correctAnswers,
        wrongAnswers,
        skipped,
        timeTaken,
        grade,
        passed,
      },
    });

    await deleteCache(CacheKeys.activeAttempt(attempt.studentId, attempt.examId));

    await this.logActivity(attemptId, attempt.studentId, attempt.examId, 'exam_submitted', null, {
      submitType,
      totalScore,
      percentage,
    });

    logger.info('Exam attempt submitted:', { attemptId, totalScore, percentage, grade });

    return {
      attemptId: updatedAttempt.id,
      status: updatedAttempt.status,
      totalScore: updatedAttempt.totalScore,
      maxScore: exam.totalMarks,
      percentage,
      correctAnswers,
      wrongAnswers,
      skipped,
      timeTaken: formatDuration(timeTaken),
      grade,
      passed,
    };
  }

  /**
   * Get attempt result
   */
  async getAttemptResult(attemptId, studentId, userRole) {
    const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) {
      throw ApiError.notFound('Attempt not found');
    }

    if (userRole === 'student') {
      const attemptStudentId = attempt.studentId;
      const userId = String(studentId);
      if (attemptStudentId !== userId) {
        throw ApiError.forbidden('Access denied');
      }
    }

    if (userRole === 'educator') {
      const exam = await prisma.exam.findUnique({ where: { id: attempt.examId } });
      if (exam.createdById !== studentId) {
        const user = await prisma.user.findUnique({ where: { id: studentId } });
        if (!exam.institutionId || !user.institutionId || exam.institutionId !== user.institutionId) {
          throw ApiError.forbidden('Access denied');
        }
      }
    }

    if (!['submitted', 'auto_submitted', 'graded'].includes(attempt.status)) {
      throw ApiError.badRequest('Attempt not yet submitted');
    }

    const exam = await prisma.exam.findUnique({ where: { id: attempt.examId } });
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId },
      include: { question: { include: { options: true } } },
    });

    const detailedAnswers = answers.map((a) => ({
      questionId: a.question.id,
      questionText: a.question.questionText,
      questionType: a.question.questionType,
      options: a.question.options,
      selectedAnswer: a.selectedAnswer,
      isCorrect: a.isCorrect,
      marksAwarded: a.marksAwarded,
      maxMarks: a.question.marks,
      correctAnswer: a.question.correctAnswer,
      explanation: a.question.explanation,
    }));

    return {
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      totalScore: attempt.totalScore,
      maxScore: exam.totalMarks,
      percentage: attempt.percentage,
      correctAnswers: attempt.correctAnswers,
      wrongAnswers: attempt.wrongAnswers,
      skipped: attempt.skipped,
      timeTaken: formatDuration(attempt.timeTaken),
      grade: attempt.grade,
      passed: attempt.passed,
      showAnswers: exam.showAnswers || userRole !== 'student',
      answers: detailedAnswers,
    };
  }

  /**
   * Get student's attempts for an exam
   */
  async getStudentAttempts(studentId, filters = {}) {
    const { examId, status, page = 1, limit = 20 } = filters;

    const query = { studentId };
    if (examId) query.examId = examId;
    if (status) query.status = status;

    const total = await prisma.examAttempt.count({ where: query });
    const skip = (page - 1) * limit;

    const attempts = await prisma.examAttempt.findMany({
      where: query,
      include: { exam: { select: { id: true, title: true, courseId: true, durationMinutes: true, totalMarks: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit, 10),
    });

    const formattedAttempts = attempts.map((a) => ({
      attemptId: a.id,
      examId: a.exam?.id,
      examTitle: a.exam?.title,
      attemptNumber: a.attemptNumber,
      status: a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      totalScore: a.totalScore,
      percentage: a.percentage,
      grade: a.grade,
      passed: a.passed,
      timeSpent: a.timeTaken,
    }));

    return {
      attempts: formattedAttempts,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get student's attempts for a specific exam
   */
  async getStudentExamAttempts(examId, studentId) {
    const attempts = await prisma.examAttempt.findMany({
      where: { examId, studentId },
      orderBy: { attemptNumber: 'desc' },
    });

    return attempts.map((a) => ({
      attemptId: a.id,
      attemptNumber: a.attemptNumber,
      status: a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      totalScore: a.totalScore,
      percentage: a.percentage,
      grade: a.grade,
      passed: a.passed,
    }));
  }

  /**
   * Check if answer is correct
   */
  checkAnswer(question, selectedAnswer) {
    switch (question.questionType) {
      case 'mcq':
      case 'multiple_choice':
      case 'true_false':
        if (question.options && question.options.length > 0) {
          const correctOption = question.options.find((opt) => opt.isCorrect);
          if (correctOption) {
            const selectedId = selectedAnswer?.toString() || selectedAnswer;
            const correctId = correctOption.id?.toString() || correctOption.id;

            if (selectedId && correctId) {
              return selectedId === correctId;
            }
            return selectedAnswer === correctOption.text;
          }
        }
        return String(selectedAnswer || '').toLowerCase().trim() ===
          String(question.correctAnswer || '').toLowerCase().trim();

      case 'multiple':
      case 'multiple_select':
        if (question.options && question.options.length > 0) {
          const correctOptionIds = question.options
            .filter((opt) => opt.isCorrect)
            .map((opt) => opt.id?.toString() || opt.id);

          if (!Array.isArray(selectedAnswer)) return false;

          const selectedIds = selectedAnswer.map((a) => (a?.toString ? a.toString() : a));

          return selectedIds.length === correctOptionIds.length &&
            selectedIds.every((id) => correctOptionIds.includes(id));
        }
        if (!Array.isArray(selectedAnswer) || !Array.isArray(question.correctAnswer)) {
          return false;
        }
        return selectedAnswer.length === question.correctAnswer.length &&
          selectedAnswer.every((a) => question.correctAnswer.includes(a));

      case 'numerical':
        return Math.abs(Number(selectedAnswer) - Number(question.correctAnswer)) < 0.001;

      case 'short_answer':
        return selectedAnswer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();

      default:
        return false;
    }
  }

  /**
   * Calculate grade
   */
  calculateGrade(percentage) {
    if (percentage >= 90) return 'A+';
    if (percentage >= 80) return 'A';
    if (percentage >= 70) return 'B';
    if (percentage >= 60) return 'C';
    if (percentage >= 50) return 'D';
    return 'F';
  }

  /**
   * Resume an existing attempt
   */
  async resumeAttempt(attemptOrExamId, studentId, findByExamId = false) {
    let attempt;

    if (findByExamId) {
      attempt = await prisma.examAttempt.findFirst({
        where: { examId: attemptOrExamId, studentId, status: { in: ['started', 'in_progress'] } },
      });
    } else {
      attempt = await prisma.examAttempt.findFirst({
        where: { id: attemptOrExamId, studentId, status: { in: ['started', 'in_progress'] } },
      });
    }

    if (!attempt) {
      throw ApiError.notFound('No active attempt found');
    }

    const exam = await this.getExamWithQuestions(attempt.examId);
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    const endTime = new Date(attempt.startedAt);
    endTime.setMinutes(endTime.getMinutes() + exam.durationMinutes);

    if (new Date() > endTime) {
      await this.autoSubmitAttempt(attempt.id);
      throw ApiError.badRequest('Time expired. Exam has been auto-submitted.');
    }

    const questions = exam.questions.map((rel) => rel.question);
    const answers = await prisma.studentAnswer.findMany({ where: { attemptId: attempt.id } });
    const answerMap = {};
    answers.forEach((a) => {
      answerMap[a.questionId.toString()] = {
        selectedAnswer: a.selectedAnswer,
        isAnswered: a.isAnswered,
        isMarkedForReview: a.isMarkedForReview || false,
      };
    });

    const formattedQuestions = questions.map((q, index) => ({
      id: q.id,
      questionNumber: index + 1,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options?.map((o) => ({ id: o.id, text: o.text })),
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      savedAnswer: answerMap[q.id.toString()] || null,
    }));

    return {
      attempt: {
        id: attempt.id,
        startedAt: attempt.startedAt,
        status: attempt.status,
        exam: { durationMinutes: exam.durationMinutes },
      },
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      totalQuestions: questions.length,
      totalMarks: exam.totalMarks,
      negativeMarking: exam.negativeMarking,
      startedAt: attempt.startedAt,
      endTime: endTime.toISOString(),
      timeRemaining: Math.max(0, Math.floor((endTime - new Date()) / 1000)),
      questions: formattedQuestions,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        selectedAnswer: a.selectedAnswer,
        isAnswered: a.isAnswered,
        isMarkedForReview: a.isMarkedForReview || false,
      })),
      answeredCount: answers.filter((a) => a.isAnswered).length,
      markedForReviewCount: answers.filter((a) => a.isMarkedForReview).length,
    };
  }

  /**
   * Get attempt details (for reviewing/resuming)
   */
  async getAttemptDetails(attemptId, userId, userRole) {
    const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) {
      throw ApiError.notFound('Attempt not found');
    }

    if (userRole === 'student' && attempt.studentId !== userId) {
      throw ApiError.forbidden('Access denied');
    }

    const exam = await this.getExamWithQuestions(attempt.examId);
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId },
      include: { question: true },
    });

    if (['started', 'in_progress'].includes(attempt.status)) {
      const questions = exam.questions.map((rel) => rel.question);
      const answerMap = {};
      answers.forEach((a) => {
        answerMap[a.question.id.toString()] = {
          selectedAnswer: a.selectedAnswer,
          isAnswered: a.isAnswered,
          isMarkedForReview: a.isMarkedForReview || false,
        };
      });

      return {
        attemptId: attempt.id,
        examId: exam.id,
        examTitle: exam.title,
        status: attempt.status,
        startedAt: attempt.startedAt,
        durationMinutes: exam.durationMinutes,
        questions: questions.map((q, idx) => ({
          id: q.id,
          questionNumber: idx + 1,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options?.map((o) => ({ id: o.id, text: o.text })),
          marks: q.marks,
          savedAnswer: answerMap[q.id.toString()] || null,
        })),
      };
    }

    return this.getAttemptResult(attemptId, userId, userRole);
  }

  /**
   * Mark question for review
   */
  async markForReview(attemptId, questionId, isMarked, studentId) {
    const attempt = await prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId, status: { in: ['started', 'in_progress'] } },
    });

    if (!attempt) {
      throw ApiError.notFound('Active attempt not found');
    }

    await prisma.studentAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: { isMarkedForReview: isMarked },
      create: { attemptId, questionId, isMarkedForReview: isMarked },
    });

    return { success: true, isMarked };
  }

  /**
   * Log exam activity
   */
  async logActivity(attemptId, studentId, examId, eventType, questionId = null, metadata = {}) {
    try {
      await prisma.examActivityLog.create({
        data: {
          attemptId,
          studentId,
          examId,
          eventType,
          questionId,
          previousAnswer: metadata.previousAnswer,
          newAnswer: metadata.newAnswer,
          timeSpentOnQuestion: metadata.timeSpent,
          metadata: {
            browserInfo: metadata.browserInfo,
            ipAddress: metadata.ipAddress,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to log activity:', error);
    }
  }
}

module.exports = new AttemptService();