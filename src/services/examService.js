/**
 * 🎓 Academic Intelligence Platform - Exam Service (SQL/Prisma)
 * Complete exam management using MySQL
 */

const { prisma } = require('../config/database');
const { setCache, getCache, deleteCache, CacheKeys } = require('../config/redis');
const { ApiError, paginate, buildPaginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');

class ExamService {
  buildExamIncludes(includeQuestions = false) {
    return {
      course: { select: { id: true, name: true, code: true } },
      subject: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      examSections: { include: { section: { select: { id: true, name: true, year: true, semester: true } } } },
      examDepartments: { include: { department: { select: { id: true, name: true, code: true } } } },
      examStudents: { include: { student: { select: { id: true, firstName: true, lastName: true, email: true, studentId: true } } } },
      questions: includeQuestions
        ? {
          include: {
            question: {
              include: { options: true },
            },
          },
        }
        : false,
      _count: { select: { questions: true } },
    };
  }

  /**
   * Create a new exam
   */
  async createExam(examData, creatorId) {
    const {
      courseId, subjectId, title, description, instructions, examType,
      durationMinutes, totalMarks, passingMarks, passingPercentage,
      negativeMarking, negativeMarkValue, shuffleQuestions, shuffleOptions,
      showResult, showAnswers, allowReview, maxAttempts, startTime, endTime,
      assignedSections, assignedDepartments, assignedStudents, assignmentMode,
    } = examData;

    const user = await prisma.user.findUnique({ where: { id: creatorId } });
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    if (courseId) {
      const course = await prisma.course.findFirst({
        where: { id: courseId, isActive: true },
      });
      if (!course) {
        throw ApiError.notFound('Course not found');
      }
      if (user.role === 'educator' && course.instructorId !== creatorId) {
        throw ApiError.forbidden('You can only create exams for courses you teach');
      }
    }

    const exam = await prisma.exam.create({
      data: {
        courseId: courseId || undefined,
        subjectId: subjectId || undefined,
        createdById: creatorId,
        institutionId: user.institutionId || undefined,
        title,
        description,
        instructions,
        examType: examType || 'quiz',
        durationMinutes: durationMinutes || 60,
        totalMarks: totalMarks || 100,
        passingMarks,
        passingPercentage: passingPercentage || 40,
        negativeMarking: negativeMarking || false,
        negativeMarkValue: negativeMarkValue || 0,
        shuffleQuestions: shuffleQuestions ?? true,
        shuffleOptions: shuffleOptions ?? true,
        showResult: showResult ?? true,
        showAnswers: showAnswers ?? false,
        allowReview: allowReview ?? true,
        maxAttempts: maxAttempts || 1,
        startTime,
        endTime,
        status: 'draft',
        assignmentMode: assignmentMode || 'section',
        examSections: assignedSections?.length
          ? { create: assignedSections.map((sectionId) => ({ sectionId })) }
          : undefined,
        examDepartments: assignedDepartments?.length
          ? { create: assignedDepartments.map((departmentId) => ({ departmentId })) }
          : undefined,
        examStudents: assignedStudents?.length
          ? { create: assignedStudents.map((studentId) => ({ studentId })) }
          : undefined,
      },
      include: this.buildExamIncludes(false),
    });

    logger.info('Exam created:', { examId: exam.id, courseId, creatorId });

    return this.formatExamResponse(exam);
  }

  /**
   * Get exam by ID
   */
  async getExamById(examId, userId, userRole) {
    const cached = await getCache(CacheKeys.examDetails(examId));
    if (cached && userRole !== 'student') {
      return cached;
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(true),
    });

    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'student') {
      if (!['published', 'active', 'completed'].includes(exam.status)) {
        logger.warn('Student trying to access unpublished exam:', {
          examId,
          studentId: userId,
          examStatus: exam.status,
        });
        throw ApiError.notFound(`This exam is currently unavailable (${exam.status}). Please ask your instructor to publish it.`);
      }

      const student = await prisma.user.findUnique({
        where: { id: userId },
        select: { sectionId: true, departmentId: true, institutionId: true },
      });
      if (!student) {
        throw ApiError.notFound('Student not found');
      }

      const assignedSectionIds = exam.examSections.map((rel) => rel.sectionId);
      const assignedDepartmentIds = exam.examDepartments.map((rel) => rel.departmentId);
      const assignedStudentIds = exam.examStudents.map((rel) => rel.studentId);

      const isAssigned =
        exam.assignmentMode === 'all' ||
        (student.sectionId && assignedSectionIds.includes(student.sectionId)) ||
        (student.departmentId && assignedDepartmentIds.includes(student.departmentId)) ||
        assignedStudentIds.includes(userId);

      if (!isAssigned) {
        throw ApiError.forbidden('This exam is not assigned to you');
      }

      if (exam.institutionId && student.institutionId && exam.institutionId !== student.institutionId) {
        throw ApiError.notFound('Exam not found');
      }
    }

    const questions = exam.questions?.map((rel) => rel.question) || [];

    const response = {
      ...this.formatExamResponse(exam),
      courseName: exam.course?.name || null,
      courseCode: exam.course?.code || null,
      creatorName: exam.createdBy ? `${exam.createdBy.firstName} ${exam.createdBy.lastName}` : null,
      questionCount: questions.length,
      questions,
    };

    if (userRole !== 'student') {
      await setCache(CacheKeys.examDetails(examId), response, 300);
    }

    return response;
  }

  /**
   * Get exams list with filters
   */
  async getExams(filters, userId, userRole) {
    const { page, limit, status, examType, search, startDate, endDate, subjectId } = filters;
    const pagination = paginate(page, limit);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { institutionId: true, sectionId: true, departmentId: true },
    });

    const query = { institutionId: user.institutionId };

    if (userRole === 'student') {
      query.status = { in: ['published', 'active', 'completed'] };
      query.OR = [
        { assignmentMode: 'all' },
        user.sectionId ? { examSections: { some: { sectionId: user.sectionId } } } : null,
        user.departmentId ? { examDepartments: { some: { departmentId: user.departmentId } } } : null,
        { examStudents: { some: { studentId: userId } } },
      ].filter(Boolean);
    } else if (userRole === 'educator') {
      query.createdById = userId;
    }

    if (status) query.status = status;
    if (examType) query.examType = examType;
    if (subjectId) query.subjectId = subjectId;
    if (search) {
      query.AND = query.AND || [];
      query.AND.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (startDate) {
      query.startTime = { gte: new Date(startDate) };
    }
    if (endDate) {
      query.endTime = { lte: new Date(endDate) };
    }

    const total = await prisma.exam.count({ where: query });

    const exams = await prisma.exam.findMany({
      where: query,
      include: this.buildExamIncludes(false),
      orderBy: { createdAt: 'desc' },
      skip: pagination.offset,
      take: pagination.limit,
    });

    const examResponses = await Promise.all(exams.map(async (exam) => {
      const attemptCount = await prisma.examAttempt.count({ where: { examId: exam.id } });
      const assignedTo = [];
      if (exam.examSections?.length > 0) {
        exam.examSections.forEach((rel) => {
          if (rel.section) assignedTo.push(`${rel.section.year}Y-${rel.section.name}`);
        });
      }
      if (exam.examDepartments?.length > 0) {
        exam.examDepartments.forEach((rel) => {
          if (rel.department) assignedTo.push(`${rel.department.code} (All)`);
        });
      }
      if (exam.assignmentMode === 'all') {
        assignedTo.push('All Students');
      }

      return {
        ...this.formatExamResponse(exam),
        subjectName: exam.subject?.name,
        subjectCode: exam.subject?.code,
        creatorName: exam.createdBy ? `${exam.createdBy.firstName} ${exam.createdBy.lastName}` : null,
        questionCount: exam._count?.questions || 0,
        attemptCount,
        assignedTo: assignedTo.join(', ') || 'Not assigned',
        assignmentMode: exam.assignmentMode,
      };
    }));

    return {
      exams: examResponses,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  /**
   * Get available exams for students based on assignment
   */
  async getAvailableExams(studentId) {
    const now = new Date();

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { sectionId: true, departmentId: true, institutionId: true },
    });
    if (!student) {
      throw ApiError.notFound('Student not found');
    }

    const exams = await prisma.exam.findMany({
      where: {
        status: { in: ['published', 'active'] },
        institutionId: student.institutionId,
        AND: [
          {
            OR: [{ startTime: null }, { startTime: { lte: now } }],
          },
          {
            OR: [{ endTime: null }, { endTime: { gte: now } }],
          },
          {
            OR: [
              { assignmentMode: 'all' },
              student.sectionId ? { examSections: { some: { sectionId: student.sectionId } } } : null,
              student.departmentId ? { examDepartments: { some: { departmentId: student.departmentId } } } : null,
              { examStudents: { some: { studentId } } },
            ].filter(Boolean),
          },
        ],
      },
      include: this.buildExamIncludes(false),
      orderBy: [{ startTime: 'asc' }, { createdAt: 'desc' }],
    });

    const examResponses = await Promise.all(exams.map(async (exam) => {
      const attempts = await prisma.examAttempt.findMany({
        where: { examId: exam.id, studentId },
        orderBy: { createdAt: 'desc' },
      });

      const attemptCount = attempts.length;
      const canAttempt = attemptCount < (exam.maxAttempts || 1);
      const lastAttempt = attempts[0];
      const activeAttempt = attempts.find((a) => ['started', 'in_progress'].includes(a.status));

      return {
        ...this.formatExamResponse(exam),
        subjectName: exam.subject?.name,
        subjectCode: exam.subject?.code,
        creatorName: exam.createdBy ? `${exam.createdBy.firstName} ${exam.createdBy.lastName}` : 'Unknown',
        questionCount: exam._count?.questions || 0,
        attemptCount,
        canAttempt: canAttempt && !activeAttempt,
        hasActiveAttempt: !!activeAttempt,
        lastAttemptStatus: lastAttempt?.status,
        lastAttemptScore: lastAttempt?.percentage,
        activeAttemptId: activeAttempt?.id,
      };
    }));

    return examResponses;
  }

  /**
   * Update exam
   */
  async updateExam(examId, updateData, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only update exams in your institution');
      }
    }

    if (['active', 'completed'].includes(exam.status)) {
      throw ApiError.badRequest('Cannot update an active or completed exam');
    }

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: updateData,
      include: this.buildExamIncludes(false),
    });

    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Exam updated:', { examId, userId });
    return this.formatExamResponse(updated);
  }

  /**
   * Delete exam
   */
  async deleteExam(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only delete exams in your institution');
      }
    }

    if (['active', 'completed'].includes(exam.status)) {
      throw ApiError.badRequest('Cannot delete an active or completed exam');
    }

    await prisma.$transaction([
      prisma.examQuestion.deleteMany({ where: { examId } }),
      prisma.examSection.deleteMany({ where: { examId } }),
      prisma.examDepartment.deleteMany({ where: { examId } }),
      prisma.examStudent.deleteMany({ where: { examId } }),
      prisma.examAssignment.deleteMany({ where: { examId } }),
      prisma.exam.delete({ where: { id: examId } }),
    ]);

    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Exam deleted:', { examId, userId });
    return true;
  }

  /**
   * Add questions to exam
   */
  async addQuestionsToExam(examId, questionIds, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only modify exams in your institution');
      }
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, marks: true },
    });
    if (questions.length !== questionIds.length) {
      throw ApiError.badRequest('Some questions not found');
    }

    await prisma.examQuestion.createMany({
      data: questionIds.map((questionId) => ({ examId, questionId })),
      skipDuplicates: true,
    });

    const allQuestions = await prisma.examQuestion.findMany({
      where: { examId },
      include: { question: { select: { marks: true } } },
    });
    const totalMarks = allQuestions.reduce((sum, rel) => sum + (rel.question.marks || 1), 0);

    await prisma.exam.update({ where: { id: examId }, data: { totalMarks } });
    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Questions added to exam:', { examId, questionCount: questionIds.length });
    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(false),
    });
    return this.formatExamResponse(updated);
  }

  /**
   * Remove questions from exam
   */
  async removeQuestionsFromExam(examId, questionIds, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only modify exams in your institution');
      }
    }

    await prisma.examQuestion.deleteMany({
      where: { examId, questionId: { in: questionIds } },
    });

    const allQuestions = await prisma.examQuestion.findMany({
      where: { examId },
      include: { question: { select: { marks: true } } },
    });
    const totalMarks = allQuestions.reduce((sum, rel) => sum + (rel.question.marks || 1), 0);

    await prisma.exam.update({ where: { id: examId }, data: { totalMarks } });
    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Questions removed from exam:', { examId, questionCount: questionIds.length });
    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(false),
    });
    return this.formatExamResponse(updated);
  }

  /**
   * Publish exam
   */
  async publishExam(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { _count: { select: { questions: true } } },
    });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only publish exams in your institution');
      }
    }

    if (exam._count.questions === 0) {
      throw ApiError.badRequest('Cannot publish exam without questions');
    }

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: { status: 'published' },
      include: this.buildExamIncludes(false),
    });
    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Exam published:', { examId, userId });
    return this.formatExamResponse(updated);
  }

  /**
   * Activate exam
   */
  async activateExam(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only activate exams in your institution');
      }
    }

    if (exam.status !== 'published') {
      throw ApiError.badRequest('Only published exams can be activated');
    }

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: { status: 'active' },
      include: this.buildExamIncludes(false),
    });
    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Exam activated:', { examId, userId });
    return this.formatExamResponse(updated);
  }

  /**
   * Close exam
   */
  async closeExam(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only close exams in your institution');
      }
    }

    if (!['published', 'active'].includes(exam.status)) {
      throw ApiError.badRequest('Only published or active exams can be closed');
    }

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: { status: 'completed' },
      include: this.buildExamIncludes(false),
    });
    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Exam closed:', { examId, userId });
    return this.formatExamResponse(updated);
  }

  /**
   * Archive exam
   */
  async archiveExam(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator' && exam.createdById !== userId) {
      throw ApiError.forbidden('You can only archive your own exams');
    }

    const updated = await prisma.exam.update({
      where: { id: examId },
      data: { status: 'archived' },
      include: this.buildExamIncludes(false),
    });
    await deleteCache(CacheKeys.examDetails(examId));

    logger.info('Exam archived:', { examId, userId });
    return this.formatExamResponse(updated);
  }

  /**
   * Assign exam to sections/departments/students
   */
  async assignExam(examId, assignmentData, userId, userRole) {
    const { sectionIds, departmentIds, studentIds, assignmentMode } = assignmentData;

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('You can only assign exams in your institution');
      }
    }

    await prisma.$transaction(async (tx) => {
      if (sectionIds) {
        await tx.examSection.deleteMany({ where: { examId } });
        if (sectionIds.length > 0) {
          await tx.examSection.createMany({
            data: sectionIds.map((sectionId) => ({ examId, sectionId })),
            skipDuplicates: true,
          });
        }
      }
      if (departmentIds) {
        await tx.examDepartment.deleteMany({ where: { examId } });
        if (departmentIds.length > 0) {
          await tx.examDepartment.createMany({
            data: departmentIds.map((departmentId) => ({ examId, departmentId })),
            skipDuplicates: true,
          });
        }
      }
      if (studentIds) {
        await tx.examStudent.deleteMany({ where: { examId } });
        if (studentIds.length > 0) {
          await tx.examStudent.createMany({
            data: studentIds.map((studentId) => ({ examId, studentId })),
            skipDuplicates: true,
          });
        }
      }
      if (assignmentMode) {
        await tx.exam.update({ where: { id: examId }, data: { assignmentMode } });
      }
    });

    await deleteCache(CacheKeys.examDetails(examId));
    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(false),
    });

    return this.formatExamResponse(updated);
  }

  /**
   * Get exam assignment details
   */
  async getExamAssignments(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(false),
    });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator' && exam.createdById !== userId) {
      throw ApiError.forbidden('Access denied');
    }

    return {
      examId: exam.id,
      assignmentMode: exam.assignmentMode,
      sections: exam.examSections.map((rel) => rel.section),
      departments: exam.examDepartments.map((rel) => rel.department),
      students: exam.examStudents.map((rel) => rel.student),
    };
  }

  /**
   * Get exam questions (for editing)
   */
  async getExamQuestions(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(true),
    });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('Access denied');
      }
    }

    return exam.questions.map((rel) => ({
      id: rel.question.id,
      questionText: rel.question.questionText,
      questionType: rel.question.questionType,
      options: rel.question.options,
      correctAnswer: rel.question.correctAnswer,
      explanation: rel.question.explanation,
      difficulty: rel.question.difficulty,
      marks: rel.question.marks,
      negativeMarks: rel.question.negativeMarks,
    }));
  }

  /**
   * Get exam analytics
   */
  async getExamAnalytics(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { institutionId: true },
      });
      if (exam.institutionId && user.institutionId && exam.institutionId !== user.institutionId) {
        throw ApiError.forbidden('Access denied');
      }
    }

    const attempts = await prisma.examAttempt.findMany({
      where: { examId },
    });

    const totalAttempts = attempts.length;
    const submittedAttempts = attempts.filter((a) => ['submitted', 'auto_submitted', 'graded'].includes(a.status));
    const passedAttempts = submittedAttempts.filter((a) => a.passed);

    const scores = submittedAttempts.map((a) => a.percentage).filter((s) => s != null);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    const gradeDistribution = {};
    submittedAttempts.forEach((a) => {
      const grade = a.grade || 'N/A';
      gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
    });

    return {
      examId: exam.id,
      title: exam.title,
      totalAttempts,
      submittedCount: submittedAttempts.length,
      passedCount: passedAttempts.length,
      failedCount: submittedAttempts.length - passedAttempts.length,
      passRate: submittedAttempts.length > 0
        ? Math.round((passedAttempts.length / submittedAttempts.length) * 100)
        : 0,
      averageScore: Math.round(averageScore * 100) / 100,
      highestScore,
      lowestScore,
      gradeDistribution,
      pendingAttempts: attempts.filter((a) => ['started', 'in_progress'].includes(a.status)).length,
    };
  }

  /**
   * Get all attempts for an exam (educator view)
   */
  async getExamAttempts(examId, filters, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator' && exam.createdById !== userId) {
      throw ApiError.forbidden('Access denied');
    }

    const { page, limit, status, search } = filters;
    const pagination = paginate(page, limit);

    const query = { examId };
    if (status) query.status = status;

    if (search) {
      query.student = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { studentId: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const total = await prisma.examAttempt.count({ where: query });

    const attempts = await prisma.examAttempt.findMany({
      where: query,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, email: true, studentId: true } },
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      skip: pagination.offset,
      take: pagination.limit,
    });

    const formattedAttempts = attempts.map((a) => ({
      attemptId: a.id,
      student: a.student ? {
        id: a.student.id,
        name: `${a.student.firstName} ${a.student.lastName}`,
        email: a.student.email,
        studentId: a.student.studentId,
      } : null,
      attemptNumber: a.attemptNumber,
      status: a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      totalScore: a.totalScore,
      percentage: a.percentage,
      grade: a.grade,
      passed: a.passed,
      timeTaken: a.timeTaken,
    }));

    return {
      attempts: formattedAttempts,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  /**
   * Export exam results
   */
  async exportExamResults(examId, format, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator' && exam.createdById !== userId) {
      throw ApiError.forbidden('Access denied');
    }

    const attempts = await prisma.examAttempt.findMany({
      where: { examId, status: { in: ['submitted', 'auto_submitted', 'graded'] } },
      include: { student: { select: { firstName: true, lastName: true, email: true, studentId: true } } },
    });

    if (format === 'csv') {
      const headers = ['Student ID', 'Name', 'Email', 'Score', 'Percentage', 'Grade', 'Status', 'Submitted At'];
      const rows = attempts.map((a) => [
        a.student?.studentId || '',
        a.student ? `${a.student.firstName} ${a.student.lastName}` : '',
        a.student?.email || '',
        a.totalScore,
        a.percentage,
        a.grade || '',
        a.status,
        a.submittedAt ? new Date(a.submittedAt).toISOString() : '',
      ]);
      return [headers, ...rows].map((row) => row.join(',')).join('\n');
    }

    return attempts.map((a) => ({
      studentId: a.student?.studentId,
      name: a.student ? `${a.student.firstName} ${a.student.lastName}` : null,
      email: a.student?.email,
      score: a.totalScore,
      percentage: a.percentage,
      grade: a.grade,
      status: a.status,
      submittedAt: a.submittedAt,
    }));
  }

  /**
   * Format exam response
   */
  formatExamResponse(exam) {
    return {
      id: exam.id,
      courseId: exam.courseId,
      subjectId: exam.subjectId,
      createdBy: exam.createdById || exam.createdBy?.id,
      title: exam.title,
      description: exam.description,
      instructions: exam.instructions,
      examType: exam.examType,
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      passingPercentage: exam.passingPercentage,
      negativeMarking: exam.negativeMarking,
      negativeMarkValue: exam.negativeMarkValue,
      shuffleQuestions: exam.shuffleQuestions,
      shuffleOptions: exam.shuffleOptions,
      showResult: exam.showResult,
      showAnswers: exam.showAnswers,
      allowReview: exam.allowReview,
      maxAttempts: exam.maxAttempts,
      status: exam.status,
      startTime: exam.startTime,
      endTime: exam.endTime,
      questionCount: exam._count?.questions || exam.questions?.length || 0,
      assignmentMode: exam.assignmentMode,
      assignedSections: exam.examSections?.map((rel) => rel.sectionId) || [],
      assignedDepartments: exam.examDepartments?.map((rel) => rel.departmentId) || [],
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
    };
  }
}

module.exports = new ExamService();