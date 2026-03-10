/**
 * 🎓 Academic Intelligence Platform - Attempt Service (SQL/Prisma)
 * Exam attempt management using MySQL
 */

const { prisma } = require('../config/database');
const { setCache, getCache, deleteCache, CacheKeys } = require('../config/redis');
const { ApiError, calculatePercentage, formatDuration } = require('../utils/helpers');
const logger = require('../utils/logger');
const { invalidateOnAttemptSubmit } = require('./cacheInvalidationService');
const { emitToExamRoom } = require('./realtimeGateway');
const { createNotification } = require('./notificationService');
const { getFlagValue } = require('./featureFlagService');
const analyticsService = require('./analyticsService');

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
   * Start an exam attempt - with race condition protection
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

    // Check student profile completion (Issue #10)
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { profileCompleted: true, institutionId: true },
    });
    if (!student?.profileCompleted) {
      throw ApiError.badRequest('Please complete your profile before attempting exams');
    }

    // Verify institution match for security (Issue #3)
    if (exam.institutionId && exam.institutionId !== student.institutionId) {
      throw ApiError.forbidden('You cannot attempt exams from other institutions');
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

    // Check course enrollment and status (Issue #27)
    if (exam.courseId) {
      logger.info('Checking course enrollment:', { studentId, courseId: exam.courseId });
      const course = await prisma.course.findUnique({
        where: { id: exam.courseId },
        select: { isActive: true },
      });
      if (!course?.isActive) {
        throw ApiError.badRequest('This course is inactive. You cannot attempt its exams');
      }

      const enrollment = await prisma.studentEnrollment.findFirst({
        where: { studentId, courseId: exam.courseId, status: 'enrolled' },
      });
      if (!enrollment) {
        logger.warn('Student not enrolled:', { studentId, courseId: exam.courseId });
        throw ApiError.forbidden('You are not enrolled in the course for this exam');
      }
    }

    // Use transaction to prevent race condition (Issue #1)
    const attempt = await prisma.$transaction(async (tx) => {
      // Check for active attempt within transaction (atomic)
      const activeAttempt = await tx.examAttempt.findFirst({
        where: { examId, studentId, status: { in: ['started', 'in_progress'] } },
      });
      if (activeAttempt) {
        logger.warn('Active attempt found:', { attemptId: activeAttempt.id, status: activeAttempt.status });
        throw ApiError.badRequest('You have an active attempt. Please complete or submit it first.');
      }

      // Get current max attempt number atomically
      const lastAttempt = await tx.examAttempt.findFirst({
        where: { examId, studentId },
        orderBy: { attemptNumber: 'desc' },
        select: { attemptNumber: true },
      });
      const nextAttemptNumber = (lastAttempt?.attemptNumber || 0) + 1;

      if (nextAttemptNumber > exam.maxAttempts) {
        throw ApiError.badRequest(`Maximum attempts reached. You have already attempted this exam ${nextAttemptNumber - 1} time(s).`);
      }

      // Create attempt within transaction
      return tx.examAttempt.create({
        data: {
          examId,
          studentId,
          attemptNumber: nextAttemptNumber,
          status: 'started',
          ipAddress: metadata.ipAddress,
          browserInfo: metadata.browserInfo || {},
          maxScore: exam.totalMarks,
        },
      });
    }, { maxWait: 5000, timeout: 10000 }); // Transaction timeout

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

    // Activate exam on first attempt
    await prisma.exam.updateMany({
      where: { id: examId, status: 'published' },
      data: { status: 'active' },
    }).catch(() => {}); // No error if already active or not published

    const endTime = new Date(attempt.startedAt);
    endTime.setMinutes(endTime.getMinutes() + exam.durationMinutes);

    await setCache(CacheKeys.activeAttempt(studentId, examId), {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      endTime: endTime.toISOString(),
    }, exam.durationMinutes * 60 + 300);

    await this.logActivity(attempt.id, studentId, examId, 'exam_started', null, metadata);

    if (getFlagValue('realtimeAnalytics')) {
      emitToExamRoom(examId, 'attempt:started', {
        attemptId: attempt.id,
        examId,
        studentId,
        startedAt: attempt.startedAt,
      });
    }

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
   * Save answer - with answer history tracking (Issue #26)
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

    // Issue #10: Attempt resumption validation - don't allow saving after time expires
    if (new Date() > endTime) {
      await this.autoSubmitAttempt(attemptId);
      throw ApiError.badRequest('Time expired. Exam has been auto-submitted.');
    }

    const existingAnswer = await prisma.studentAnswer.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    const previousAnswer = existingAnswer?.selectedAnswer;
    
    // Issue #26: Build answer history (audit trail of changes)
    let answerHistory = [];
    if (existingAnswer?.answerHistory) {
      try {
        answerHistory = Array.isArray(existingAnswer.answerHistory) 
          ? existingAnswer.answerHistory 
          : JSON.parse(existingAnswer.answerHistory || '[]');
      } catch (e) {
        answerHistory = [];
      }
    }
    
    // Add current answer to history before updating
    if (previousAnswer) {
      answerHistory.push({
        answer: previousAnswer,
        timestamp: existingAnswer.updatedAt || new Date(),
        timeSpent: existingAnswer.timeSpent || 0,
      });
    }

    // Upsert answer with history tracking
    await prisma.studentAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: {
        selectedAnswer: answer,
        isAnswered: answer !== null && answer !== undefined,
        answeredAt: new Date(),
        timeSpent: metadata.timeSpent || 0,
        answerHistory: answerHistory.length > 0 ? answerHistory : null,
      },
      create: {
        attemptId,
        questionId,
        selectedAnswer: answer,
        isAnswered: answer !== null && answer !== undefined,
        answeredAt: new Date(),
        timeSpent: metadata.timeSpent || 0,
        answerHistory: null, // No history for first answer
      },
    });

    // Update attempt status if needed
    if (attempt.status === 'started') {
      await prisma.examAttempt.update({
        where: { id: attemptId },
        data: { status: 'in_progress' },
      });
    }

    // Log activity
    const eventType = previousAnswer ? 'answer_changed' : 'answer_submitted';
    await this.logActivity(attemptId, studentId, attempt.examId, eventType, questionId, {
      ...metadata,
      previousAnswer,
      newAnswer: answer,
    });

    if (getFlagValue('realtimeAnalytics')) {
      emitToExamRoom(attempt.examId, 'attempt:answer_updated', {
        attemptId,
        questionId,
        studentId,
        eventType,
      });
    }

    logger.debug('Answer saved:', { attemptId, questionId, hasHistory: answerHistory.length > 0 });
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
   * Finalize and grade attempt - with proper negative marking handling (Issues #14, #27)
   */
  async finalizeAttempt(attemptId, submitType) {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || !['started', 'in_progress'].includes(attempt.status)) {
      throw ApiError.badRequest('Attempt already submitted');
    }

    const exam = await prisma.exam.findUnique({ where: { id: attempt.examId } });

    // Get ALL questions for the exam (not just ones with saved answers)
    const examQuestions = await prisma.examQuestion.findMany({
      where: { examId: attempt.examId },
      include: { question: { include: { options: true } } },
    });

    // Get existing student answers
    const existingAnswers = await prisma.studentAnswer.findMany({
      where: { attemptId },
    });
    const answerMap = new Map(existingAnswers.map((a) => [a.questionId, a]));

    let totalScore = 0;
    let correctAnswers = 0;
    let wrongAnswers = 0;
    let skipped = 0;

    for (const eq of examQuestions) {
      const question = eq.question;
      if (!question) continue;

      const answer = answerMap.get(question.id);

      if (!answer || !answer.isAnswered || answer.selectedAnswer === null) {
        // Question was not answered (skipped or save failed)
        skipped++;
        if (answer) {
          await prisma.studentAnswer.update({
            where: { id: answer.id },
            data: { isCorrect: false, marksAwarded: 0 },
          });
        } else {
          // Create a record for unanswered question so it shows in results
          await prisma.studentAnswer.create({
            data: {
              attemptId,
              questionId: question.id,
              selectedAnswer: null,
              isAnswered: false,
              isCorrect: false,
              marksAwarded: 0,
            },
          });
        }
      } else {
        const isCorrect = this.checkAnswer(question, answer.selectedAnswer);
        let marksAwarded = 0;

        if (isCorrect === null) {
          // Essay/descriptive: pending manual review — don't count as correct or wrong
          await prisma.studentAnswer.update({
            where: { id: answer.id },
            data: { isCorrect: null, marksAwarded: 0 },
          });
          continue;
        }

        if (isCorrect) {
          correctAnswers++;
          const marksValue = question.marks && question.marks > 0 ? question.marks : 1;
          marksAwarded = marksValue;
          totalScore += marksAwarded;
          logger.info(`Question answered correctly: ${question.id}, marks awarded: ${marksAwarded}`);
        } else {
          wrongAnswers++;
          if (exam.negativeMarking) {
            // Issue #14, #27: Better calculation for negative marking
            const negativeMarksValue = question.negativeMarks || exam.negativeMarkValue || 0;
            marksAwarded = -negativeMarksValue;
            totalScore += marksAwarded;
            logger.info(`Question answered incorrectly: ${question.id}, negative marks: ${marksAwarded}`);
          }
        }

        await prisma.studentAnswer.update({
          where: { id: answer.id },
          data: { isCorrect, marksAwarded },
        });
      }
    }

    // Issue #27: Ensure final score doesn't go below 0 for percentage calculation
    const finalScore = Math.max(0, totalScore);
    const percentage = calculatePercentage(finalScore, exam.totalMarks);
    
    // Issue #14, #27: Passing should be based on actual score, not just percentage
    // But only if actual score is non-negative
    const passed = totalScore >= 0 && percentage >= exam.passingPercentage;
    const grade = this.calculateGrade(percentage);

    const timeTaken = Math.floor((new Date() - new Date(attempt.startedAt)) / 1000);

    const updatedAttempt = await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: submitType === 'auto_submitted' ? 'auto_submitted' : 'submitted',
        submittedAt: new Date(),
        totalScore: finalScore, // Store bounded score
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
    await invalidateOnAttemptSubmit(attempt.examId, attempt.studentId);

    await this.logActivity(attemptId, attempt.studentId, attempt.examId, 'exam_submitted', null, {
      submitType,
      totalScore: finalScore,
      rawScore: totalScore,
      percentage,
    });

    if (getFlagValue('realtimeAnalytics')) {
      emitToExamRoom(attempt.examId, 'attempt:submitted', {
        attemptId,
        studentId: attempt.studentId,
        examId: attempt.examId,
        totalScore: finalScore,
        percentage,
        submitType,
      });
    }

    if (getFlagValue('websocketNotifications')) {
      await createNotification({
        userId: attempt.studentId,
        courseId: exam.courseId,
        notificationType: 'result_published',
        title: 'Exam Submitted Successfully',
        message: `Your attempt for "${exam.title}" was submitted with score ${finalScore}/${exam.totalMarks}.`,
        priority: 'medium',
        actionUrl: `/student/results/${attemptId}`,
        metadata: { examId: attempt.examId, attemptId },
      }).catch((error) => {
        logger.warn('Failed to create submission notification', { attemptId, error: error.message });
      });

      // Notify the exam creator (educator)
      if (exam.createdById) {
        const student = await prisma.user.findUnique({
          where: { id: attempt.studentId },
          select: { firstName: true, lastName: true, studentId: true },
        });
        const studentName = student ? `${student.firstName} ${student.lastName}` : 'A student';
        const studentLabel = student?.studentId ? ` (${student.studentId})` : '';
        await createNotification({
          userId: exam.createdById,
          courseId: exam.courseId,
          notificationType: 'exam_submitted',
          title: 'Exam Submission Received',
          message: `${studentName}${studentLabel} submitted "${exam.title}" with score ${finalScore}/${exam.totalMarks} (${percentage}%).`,
          priority: percentage < exam.passingPercentage ? 'high' : 'low',
          actionUrl: `/educator/exams`,
          metadata: { examId: attempt.examId, attemptId, studentId: attempt.studentId, percentage },
        }).catch((error) => {
          logger.warn('Failed to create educator submission notification', { attemptId, error: error.message });
        });

        // Low performance alert - separate notification when student fails
        if (!passed && percentage < exam.passingPercentage) {
          await createNotification({
            userId: exam.createdById,
            courseId: exam.courseId,
            notificationType: 'low_performance_alert',
            title: 'Low Performance Alert',
            message: `${studentName}${studentLabel} scored ${percentage}% on "${exam.title}" (passing: ${exam.passingPercentage}%). Consider assigning an intervention.`,
            priority: 'high',
            actionUrl: `/educator/interventions`,
            metadata: { examId: attempt.examId, attemptId, studentId: attempt.studentId, percentage, passingPercentage: exam.passingPercentage },
          }).catch((error) => {
            logger.warn('Failed to create low performance notification', { attemptId, error: error.message });
          });
        }

        // Exam completion milestone - check how many assigned students have submitted
        try {
          const assignedStudentIds = await this._getAssignedStudentIds(exam);
          if (assignedStudentIds.length > 0) {
            const submittedCount = await prisma.examAttempt.count({
              where: {
                examId: exam.id,
                studentId: { in: assignedStudentIds },
                status: { in: ['submitted', 'auto_submitted'] },
              },
            });
            const completionPct = Math.round((submittedCount / assignedStudentIds.length) * 100);

            if (submittedCount === assignedStudentIds.length) {
              await createNotification({
                userId: exam.createdById,
                courseId: exam.courseId,
                notificationType: 'exam_completion_milestone',
                title: 'All Students Completed Exam',
                message: `All ${assignedStudentIds.length} assigned students have completed "${exam.title}".`,
                priority: 'medium',
                actionUrl: `/educator/exams`,
                metadata: { examId: exam.id, totalStudents: assignedStudentIds.length, completionPct: 100 },
              }).catch(() => {});
            } else if (completionPct === 50) {
              await createNotification({
                userId: exam.createdById,
                courseId: exam.courseId,
                notificationType: 'exam_completion_milestone',
                title: 'Exam 50% Complete',
                message: `${submittedCount} of ${assignedStudentIds.length} students (50%) have completed "${exam.title}".`,
                priority: 'low',
                actionUrl: `/educator/exams`,
                metadata: { examId: exam.id, totalStudents: assignedStudentIds.length, submittedCount, completionPct: 50 },
              }).catch(() => {});
            }
          }
        } catch (error) {
          logger.warn('Failed to check exam completion milestone', { examId: exam.id, error: error.message });
        }
      }
    }

    logger.info('Exam attempt submitted:', { attemptId, totalScore: finalScore, rawScore: totalScore, percentage, grade });

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

    if (userRole === 'student' && !exam.showResult) {
      throw ApiError.forbidden('Results are not available yet. Your educator has disabled immediate result visibility.');
    }

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

    // Generate per-exam feedback inline
    let feedback = null;
    try {
      feedback = await analyticsService.getStudentFeedback(attempt.studentId, attempt.examId);
    } catch (err) {
      logger.warn('Failed to generate inline feedback for result', { attemptId, error: err.message });
    }

    // Convert seconds to minutes
    const timeInMinutes = attempt.timeTaken ? Math.round(attempt.timeTaken / 60) : 0;
    
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
      timeInMinutes: timeInMinutes,
      timeInSeconds: attempt.timeTaken || 0,
      grade: attempt.grade,
      passed: attempt.passed,
      showAnswers: exam.showAnswers || userRole !== 'student',
      answers: detailedAnswers,
      feedback,
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
      timeInMinutes: a.timeTaken ? Math.round(a.timeTaken / 60) : 0,
      timeFormatted: formatDuration(a.timeTaken),
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
   * Check if answer is correct - handles all question types robustly
   */
  checkAnswer(question, selectedAnswer) {
    if (selectedAnswer === null || selectedAnswer === undefined) return false;

    switch (question.questionType) {
      case 'mcq':
      case 'multiple':
      case 'multiple_choice':
      case 'true_false': {
        if (question.options && question.options.length > 0) {
          const correctOption = question.options.find((opt) => opt.isCorrect);
          if (correctOption) {
            const selectedStr = String(selectedAnswer).trim();
            const correctId = String(correctOption.id || '').trim();
            const correctText = String(correctOption.text || '').trim();

            // 1. Match by option ID (primary - UUID match)
            if (selectedStr === correctId) return true;

            // 2. Match by option text (case-insensitive, handles 'true' vs 'True')
            if (selectedStr.toLowerCase() === correctText.toLowerCase()) return true;

            // 3. Check if selected answer matches ANY option by ID or text
            const matchedOption = question.options.find((opt) => {
              const optId = String(opt.id || '').trim();
              const optText = String(opt.text || '').trim();
              return selectedStr === optId || selectedStr.toLowerCase() === optText.toLowerCase();
            });
            if (matchedOption) return matchedOption.isCorrect;

            return false;
          }
        }
        // Fallback to correctAnswer field (for questions without options)
        if (question.correctAnswer == null) return false;
        return String(selectedAnswer).toLowerCase().trim() ===
          String(question.correctAnswer).toLowerCase().trim();
      }

      case 'multiple_select': {
        if (question.options && question.options.length > 0) {
          const correctOptionIds = question.options
            .filter((opt) => opt.isCorrect)
            .map((opt) => String(opt.id || '').trim());
          const correctOptionTexts = question.options
            .filter((opt) => opt.isCorrect)
            .map((opt) => String(opt.text || '').toLowerCase().trim());

          if (!Array.isArray(selectedAnswer)) return false;

          // Map each selected answer to the option it matches (by ID or text)
          const matchedCorrectCount = selectedAnswer.filter((a) => {
            const val = String(a).trim();
            return correctOptionIds.includes(val) || correctOptionTexts.includes(val.toLowerCase());
          }).length;

          // All selected must be correct, and all correct must be selected
          return matchedCorrectCount === correctOptionIds.length &&
            selectedAnswer.length === correctOptionIds.length;
        }
        if (!Array.isArray(selectedAnswer) || !Array.isArray(question.correctAnswer)) {
          return false;
        }
        return selectedAnswer.length === question.correctAnswer.length &&
          selectedAnswer.every((a) => question.correctAnswer.includes(a));
      }

      case 'numerical': {
        if (question.correctAnswer == null) return false;
        const selected = Number(selectedAnswer);
        const correct = Number(question.correctAnswer);
        if (isNaN(selected) || isNaN(correct)) return false;
        return Math.abs(selected - correct) < 0.001;
      }

      case 'short_answer': {
        if (!selectedAnswer || !question.correctAnswer) return false;
        return String(selectedAnswer).toLowerCase().trim() ===
          String(question.correctAnswer).toLowerCase().trim();
      }

      case 'essay':
      case 'descriptive':
        // Essays require manual grading - return null to indicate pending review
        return null;

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
   * Skip question (clear answer and mark as unanswered)
   */
  async skipQuestion(attemptId, questionId, studentId) {
    if (!getFlagValue('skipQuestion')) {
      throw ApiError.badRequest('Skip question feature is currently disabled');
    }

    const attempt = await prisma.examAttempt.findFirst({
      where: { id: attemptId, studentId, status: { in: ['started', 'in_progress'] } },
    });

    if (!attempt) {
      throw ApiError.notFound('Active attempt not found');
    }

    await prisma.studentAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: {
        selectedAnswer: null,
        isAnswered: false,
        isMarkedForReview: false,
        answeredAt: null,
        answerHistory: null,
      },
      create: {
        attemptId,
        questionId,
        selectedAnswer: null,
        isAnswered: false,
        isMarkedForReview: false,
      },
    });

    await this.logActivity(attemptId, studentId, attempt.examId, 'question_skipped', questionId);

    if (getFlagValue('realtimeAnalytics')) {
      emitToExamRoom(attempt.examId, 'attempt:question_skipped', {
        attemptId,
        questionId,
        studentId,
      });
    }

    logger.info('Question skipped:', { attemptId, questionId, studentId });

    return {
      success: true,
      skipped: true,
      questionId,
      message: 'Question skipped successfully',
    };
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

  /**
   * Get all student IDs assigned to an exam (via sections, departments, or direct assignment)
   */
  async _getAssignedStudentIds(exam) {
    const studentIdSet = new Set();

    // Direct student assignments
    const directStudents = await prisma.examStudent.findMany({
      where: { examId: exam.id },
      select: { studentId: true },
    });
    directStudents.forEach(s => studentIdSet.add(s.studentId));

    // Students from assigned sections
    const examSections = await prisma.examSection.findMany({
      where: { examId: exam.id },
      select: { sectionId: true },
    });
    if (examSections.length > 0) {
      const sectionStudents = await prisma.user.findMany({
        where: {
          role: 'student',
          isActive: true,
          sectionId: { in: examSections.map(s => s.sectionId) },
        },
        select: { id: true },
      });
      sectionStudents.forEach(s => studentIdSet.add(s.id));
    }

    // Students from assigned departments
    const examDepts = await prisma.examDepartment.findMany({
      where: { examId: exam.id },
      select: { departmentId: true },
    });
    if (examDepts.length > 0) {
      const deptStudents = await prisma.user.findMany({
        where: {
          role: 'student',
          isActive: true,
          departmentId: { in: examDepts.map(d => d.departmentId) },
        },
        select: { id: true },
      });
      deptStudents.forEach(s => studentIdSet.add(s.id));
    }

    return Array.from(studentIdSet);
  }
}

module.exports = new AttemptService();