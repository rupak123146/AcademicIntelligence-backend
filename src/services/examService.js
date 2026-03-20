/**
 * 🎓 Academic Intelligence Platform - Exam Service (SQL/Prisma)
 * Complete exam management using MySQL
 */

const { prisma } = require('../config/database');
const { setCache, getCache, CacheKeys } = require('../config/redis');
const { ApiError, paginate, buildPaginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');
const { invalidateExamCache } = require('./cacheInvalidationService');
const { createNotification, notifyInstitution } = require('./notificationService');
const { emitToExamRoom } = require('./realtimeGateway');
const { getFlagValue } = require('./featureFlagService');

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

  async syncExpiredExamStatuses(institutionId) {
    const where = {
      status: { in: ['published', 'active'] },
      endTime: { lte: new Date() },
      ...(institutionId ? { institutionId } : {}),
    };

    const resultByEndTime = await prisma.exam.updateMany({
      where,
      data: { status: 'completed' },
    });

    const candidatesWithoutEndTime = await prisma.exam.findMany({
      where: {
        status: { in: ['published', 'active'] },
        endTime: null,
        ...(institutionId ? { institutionId } : {}),
      },
      select: {
        id: true,
        startTime: true,
        createdAt: true,
        durationMinutes: true,
      },
    });

    const now = new Date();
    const expiredByDurationIds = candidatesWithoutEndTime
      .filter((exam) => {
        const start = exam.startTime ? new Date(exam.startTime) : new Date(exam.createdAt);
        const computedEnd = new Date(start);
        computedEnd.setMinutes(computedEnd.getMinutes() + (exam.durationMinutes || 0));
        return computedEnd <= now;
      })
      .map((exam) => exam.id);

    const candidatesWithWindow = await prisma.exam.findMany({
      where: {
        status: { in: ['published', 'active'] },
        startTime: { not: null },
        endTime: { not: null },
        ...(institutionId ? { institutionId } : {}),
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
      },
    });

    const expiredByEffectiveEndIds = candidatesWithWindow
      .filter((exam) => {
        const start = new Date(exam.startTime);
        const byDuration = new Date(start);
        byDuration.setMinutes(byDuration.getMinutes() + (exam.durationMinutes || 0));
        const byWindow = new Date(exam.endTime);
        const effectiveEnd = byDuration <= byWindow ? byDuration : byWindow;
        return effectiveEnd <= now;
      })
      .map((exam) => exam.id);

    const idsToClose = Array.from(new Set([...expiredByDurationIds, ...expiredByEffectiveEndIds]));

    let closedByDurationCount = 0;
    if (idsToClose.length > 0) {
      const resultByDuration = await prisma.exam.updateMany({
        where: { id: { in: idsToClose } },
        data: { status: 'completed' },
      });
      closedByDurationCount = resultByDuration.count;
    }

    const closedCount = resultByEndTime.count + closedByDurationCount;

    if (closedCount > 0) {
      logger.info('Auto-closed expired exams', {
        institutionId: institutionId || null,
        closedCount,
        closedByEndTime: resultByEndTime.count,
        closedByDuration: closedByDurationCount,
      });
    }

    return closedCount;
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

    await invalidateExamCache(exam.id, user.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on exam create', { examId: exam.id, error: error.message });
    });

    logger.info('Exam created:', { examId: exam.id, courseId, creatorId });

    return this.formatExamResponse(exam);
  }

  /**
   * Get exam by ID
   */
  async getExamById(examId, userId, userRole) {
    await this.syncExpiredExamStatuses().catch((error) => {
      logger.warn('Failed to sync expired exam statuses before getExamById', { examId, error: error.message });
    });

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
   * Get exam preview (metadata only, no questions)
   */
  async getExamPreview(examId, userId, userRole) {
    await this.syncExpiredExamStatuses().catch((error) => {
      logger.warn('Failed to sync expired exam statuses before getExamPreview', { examId, error: error.message });
    });

    if (!getFlagValue('examPreview')) {
      throw ApiError.badRequest('Exam preview is currently disabled');
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        course: { select: { id: true, name: true, code: true } },
        subject: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        examSections: { select: { sectionId: true } },
        examDepartments: { select: { departmentId: true } },
        examStudents: { select: { studentId: true } },
        _count: { select: { questions: true, attempts: true } },
      },
    });

    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'student') {
      if (!['published', 'active', 'completed'].includes(exam.status)) {
        throw ApiError.notFound(`This exam is currently unavailable (${exam.status})`);
      }

      const student = await prisma.user.findUnique({
        where: { id: userId },
        select: { sectionId: true, departmentId: true, institutionId: true },
      });
      if (!student) {
        throw ApiError.notFound('Student not found');
      }

      if (exam.institutionId && student.institutionId && exam.institutionId !== student.institutionId) {
        throw ApiError.notFound('Exam not found');
      }

      const assignedSectionIds = exam.examSections.map((r) => r.sectionId);
      const assignedDepartmentIds = exam.examDepartments.map((r) => r.departmentId);
      const assignedStudentIds = exam.examStudents.map((r) => r.studentId);

      const isAssigned =
        exam.assignmentMode === 'all' ||
        (student.sectionId && assignedSectionIds.includes(student.sectionId)) ||
        (student.departmentId && assignedDepartmentIds.includes(student.departmentId)) ||
        assignedStudentIds.includes(userId);

      if (!isAssigned) {
        throw ApiError.forbidden('This exam is not assigned to you');
      }
    }

    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      instructions: exam.instructions,
      examType: exam.examType,
      status: exam.status,
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
      startTime: exam.startTime,
      endTime: exam.endTime,
      courseName: exam.course?.name,
      courseCode: exam.course?.code,
      subjectName: exam.subject?.name,
      creatorName: exam.createdBy ? `${exam.createdBy.firstName} ${exam.createdBy.lastName}` : null,
      questionCount: exam._count.questions,
      totalAttempts: exam._count.attempts,
      createdAt: exam.createdAt,
    };
  }

  /**
   * Get exams list with filters
   */
  async getExams(filters, userId, userRole) {
    const {
      page,
      limit,
      status,
      examType,
      search,
      startDate,
      endDate,
      subjectId,
      courseId,
      assignmentMode,
      minDuration,
      maxDuration,
    } = filters;
    const pagination = paginate(page, limit);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { institutionId: true, sectionId: true, departmentId: true },
    });

    await this.syncExpiredExamStatuses(user?.institutionId).catch((error) => {
      logger.warn('Failed to sync expired exam statuses before getExams', { userId, error: error.message });
    });

    const query = {};
    if (user?.institutionId) {
      query.institutionId = user.institutionId;
    }

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
    if (courseId) query.courseId = courseId;
    if (assignmentMode) query.assignmentMode = assignmentMode;
    if (minDuration || maxDuration) {
      query.durationMinutes = {
        ...(minDuration ? { gte: parseInt(minDuration, 10) } : {}),
        ...(maxDuration ? { lte: parseInt(maxDuration, 10) } : {}),
      };
    }

    if (search) {
      query.AND = query.AND || [];
      const searchableFields = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];

      if (getFlagValue('advancedSearch')) {
        searchableFields.push(
          { instructions: { contains: search, mode: 'insensitive' } },
          { subject: { name: { contains: search, mode: 'insensitive' } } },
          { subject: { code: { contains: search, mode: 'insensitive' } } },
          { course: { name: { contains: search, mode: 'insensitive' } } },
          { course: { code: { contains: search, mode: 'insensitive' } } }
        );
      }

      query.AND.push({
        OR: searchableFields,
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

    await this.syncExpiredExamStatuses(student.institutionId).catch((error) => {
      logger.warn('Failed to sync expired exam statuses before getAvailableExams', { studentId, error: error.message });
    });

    logger.info('Student requesting available exams:', {
      studentId,
      sectionId: student.sectionId,
      departmentId: student.departmentId,
      institutionId: student.institutionId,
    });

    const exams = await prisma.exam.findMany({
      where: {
        status: { in: ['published', 'active'] },
        institutionId: student.institutionId,
        AND: [
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

    logger.info(`Found ${exams.length} available exams for student:`, {
      studentId,
      examIds: exams.map(e => e.id),
      examTitles: exams.map(e => ({ id: e.id, title: e.title, mode: e.assignmentMode })),
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
      const notStartedYet = exam.startTime ? new Date(exam.startTime) > now : false;

      return {
        ...this.formatExamResponse(exam),
        subjectName: exam.subject?.name,
        subjectCode: exam.subject?.code,
        creatorName: exam.createdBy ? `${exam.createdBy.firstName} ${exam.createdBy.lastName}` : 'Unknown',
        questionCount: exam._count?.questions || 0,
        attemptCount,
        canAttempt: canAttempt && !activeAttempt && !notStartedYet,
        isUpcoming: notStartedYet,
        hasActiveAttempt: !!activeAttempt,
        lastAttemptStatus: lastAttempt?.status,
        lastAttemptScore: lastAttempt?.percentage,
        activeAttemptId: activeAttempt?.id,
      };
    }));

    return examResponses;
  }

  /**
   * Issue #19: Validate exam state transitions (state machine)
   */
  isValidStatusTransition(fromStatus, toStatus) {
    const validTransitions = {
      draft: ['published', 'archived', 'deleted'],
      published: ['active', 'archived', 'draft'], // Can revert from published
      active: ['completed', 'archived'],
      completed: ['archived'],
      archived: [], // Terminal state
    };
    return validTransitions[fromStatus]?.includes(toStatus) ?? false;
  }

  /**
   * Update exam - with state machine validation
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

    // Issue #19: Prevent updates to active/completed exams
    if (['active', 'completed'].includes(exam.status)) {
      throw ApiError.badRequest('Cannot update an active or completed exam');
    }

    // Issue #19: Validate status transition if changing status
    if (updateData.status && updateData.status !== exam.status) {
      if (!this.isValidStatusTransition(exam.status, updateData.status)) {
        throw ApiError.badRequest(
          `Cannot transition from ${exam.status} to ${updateData.status}`
        );
      }
    }

    // Use optimistic locking only when the current Prisma client exposes `version`.
    const supportsOptimisticLock = typeof exam.version === 'number';
    let updated;

    if (supportsOptimisticLock) {
      const optimisticResult = await prisma.exam.updateMany({
        where: { id: examId, version: exam.version },
        data: { ...updateData, version: { increment: 1 } },
      });

      if (optimisticResult.count === 0) {
        throw ApiError.conflict('Exam was modified by another user. Please refresh and try again.');
      }

      updated = await prisma.exam.findUnique({
        where: { id: examId },
        include: this.buildExamIncludes(false),
      });
    } else {
      updated = await prisma.exam.update({
        where: { id: examId },
        data: updateData,
        include: this.buildExamIncludes(false),
      });
    }

    // Log audit trail when the Prisma client exposes the delegate.
    if (updateData.status || Object.keys(updateData).length > 0) {
      const auditDelegate = prisma?.examAuditLog;
      if (auditDelegate && typeof auditDelegate.create === 'function') {
        await auditDelegate.create({
          data: {
            examId,
            userId,
            action: updateData.status ? 'status_changed' : 'updated',
            changes: updateData,
            timestamp: new Date(),
          },
        }).catch(err => logger.warn('Failed to log audit', { err }));
      } else {
        logger.warn('Exam audit log delegate unavailable. Skipping audit write.', { examId, userId });
      }
    }

    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on exam update', { examId, error: error.message });
    });

    if (getFlagValue('websocketNotifications')) {
      notifyInstitution(exam.institutionId, 'exam:updated', {
        examId,
        status: updated.status,
        title: updated.title,
      });
    }

    logger.info('Exam updated:', { examId, userId, changes: Object.keys(updateData) });
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

    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on exam delete', { examId, error: error.message });
    });

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
    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on add questions', { examId, error: error.message });
    });

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
    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on remove questions', { examId, error: error.message });
    });

    logger.info('Questions removed from exam:', { examId, questionCount: questionIds.length });
    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(false),
    });
    return this.formatExamResponse(updated);
  }

  /**
   * Publish exam - with comprehensive validation
   */
  async publishExam(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { 
        questions: { include: { question: { include: { options: true } } } },
        _count: { 
          select: { 
            questions: true,
            examSections: true,
            examDepartments: true,
            examStudents: true,
          } 
        } 
      },
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

    // Issue #9: Validate minimum questions
    if (exam._count.questions === 0) {
      throw ApiError.badRequest('Cannot publish exam without questions. Add at least 1 question.');
    }

    // Issue #9: Validate all questions have correct answers
    const invalidQuestions = exam.questions.filter(rel => {
      const q = rel.question;
      // For short_answer, essay, numerical - correctAnswer in JSON field
      if (['short_answer', 'essay', 'numerical'].includes(q.questionType)) {
        return !q.correctAnswer;
      }
      // For true_false and MCQ types - check isCorrect flag on options
      if (['true_false', 'mcq', 'multiple', 'multiple_choice'].includes(q.questionType)) {
        return !q.options || !q.options.some(opt => opt.isCorrect);
      }
      return false;
    });
    
    if (invalidQuestions.length > 0) {
      throw ApiError.badRequest(
        `${invalidQuestions.length} question(s) don't have correct answers defined. Please review them before publishing.`
      );
    }

    // Issue #2: Time validation - startTime must be before endTime
    const now = new Date();
    if (exam.endTime && new Date(exam.endTime) <= now) {
      throw ApiError.badRequest('Cannot publish exam because end time is already in the past');
    }

    if (exam.startTime && exam.endTime && new Date(exam.startTime) >= new Date(exam.endTime)) {
      throw ApiError.badRequest('Cannot publish exam because start time must be before end time');
    }

    // If startTime is set, ensure it's in the future (Issue #2)
    if (exam.startTime && new Date(exam.startTime) <= now) {
      throw ApiError.badRequest('Exam start time must be in the future');
    }

    // Validate exam is assigned to someone
    const hasAssignments = 
      exam.assignmentMode === 'all' ||
      exam._count.examSections > 0 ||
      exam._count.examDepartments > 0 ||
      exam._count.examStudents > 0;

    if (!hasAssignments) {
      throw ApiError.badRequest(
        'Cannot publish exam without assignments. Please go to Assignment tab and select sections, departments, or change assignment mode to "All Students"'
      );
    }

    const supportsOptimisticLock = typeof exam.version === 'number';
    let updated;

    if (supportsOptimisticLock) {
      const optimisticResult = await prisma.exam.updateMany({
        where: { id: examId, version: exam.version },
        data: { status: 'published', version: { increment: 1 } },
      });

      if (optimisticResult.count === 0) {
        throw ApiError.conflict('Exam was modified by another user. Please refresh and try again.');
      }

      updated = await prisma.exam.findUnique({
        where: { id: examId },
        include: this.buildExamIncludes(false),
      });
    } else {
      updated = await prisma.exam.update({
        where: { id: examId },
        data: { status: 'published' },
        include: this.buildExamIncludes(false),
      });
    }

    // Issue #21: Log to audit trail when available.
    const auditDelegate = prisma?.examAuditLog;
    if (auditDelegate && typeof auditDelegate.create === 'function') {
      await auditDelegate.create({
        data: {
          examId,
          userId,
          action: 'published',
          changes: {},
          timestamp: new Date(),
        },
      }).catch(err => logger.warn('Failed to log audit', { err }));
    } else {
      logger.warn('Exam audit log delegate unavailable. Skipping publish audit write.', { examId, userId });
    }

    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on publish', { examId, error: error.message });
    });

    if (getFlagValue('websocketNotifications')) {
      notifyInstitution(exam.institutionId, 'exam:published', {
        examId,
        title: updated.title,
        startTime: updated.startTime,
        endTime: updated.endTime,
      });

      emitToExamRoom(examId, 'exam:status_changed', {
        examId,
        status: 'published',
      });
    }

    logger.info('Exam published:', { examId, userId, version: exam.version ?? null });
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
    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on activate', { examId, error: error.message });
    });

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
    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on close', { examId, error: error.message });
    });

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
    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on archive', { examId, error: error.message });
    });

    logger.info('Exam archived:', { examId, userId });
    return this.formatExamResponse(updated);
  }

  /**
   * Assign exam to sections/departments/students
   */
  async assignExam(examId, assignmentData, userId, userRole) {
    const { sectionIds, departmentIds, studentIds, assignmentMode } = assignmentData;
    const normalizedSectionIds = Array.isArray(sectionIds) ? sectionIds : undefined;
    const normalizedDepartmentIds = Array.isArray(departmentIds) ? departmentIds : undefined;
    const normalizedStudentIds = Array.isArray(studentIds) ? studentIds : undefined;

    logger.info('Assigning exam:', {
        examId,
        assignmentData,
        sectionIds: normalizedSectionIds,
        departmentIds: normalizedDepartmentIds,
        assignmentMode,
    });

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

      // Verify course is active if exam is assigned to a course (Issue #27)
      if (exam.courseId) {
        const course = await prisma.course.findUnique({
          where: { id: exam.courseId },
          select: { id: true, isActive: true, code: true },
        });
        if (!course) {
          throw ApiError.notFound('Course not found');
        }
        if (!course.isActive) {
          throw ApiError.badRequest(
            `Cannot assign exam to inactive course (${course.code}). Please activate the course first.`
          );
        }
      }

      // Validate sections exist and are active (Issue #27)
      if (normalizedSectionIds !== undefined && normalizedSectionIds.length > 0) {
        const sections = await prisma.section.findMany({
          where: { id: { in: normalizedSectionIds } },
          select: { id: true, name: true, isActive: true },
        });
      
        if (sections.length !== normalizedSectionIds.length) {
          const foundIds = sections.map(s => s.id);
          const missingIds = normalizedSectionIds.filter(id => !foundIds.includes(id));
          throw ApiError.badRequest(`Sections not found: ${missingIds.join(', ')}`);
        }

        const inactiveSections = sections.filter(s => !s.isActive);
        if (inactiveSections.length > 0) {
          const sectionNames = inactiveSections.map(s => s.name).join(', ');
          logger.warn('Attempting to assign to inactive sections:', { sectionNames });
          throw ApiError.badRequest(
            `Cannot assign to inactive sections: ${sectionNames}`
          );
        }
      }

      // Validate departments exist and are active (Issue #27)
      if (normalizedDepartmentIds !== undefined && normalizedDepartmentIds.length > 0) {
        const departments = await prisma.department.findMany({
          where: { id: { in: normalizedDepartmentIds } },
          select: { id: true, name: true, isActive: true },
        });

        if (departments.length !== normalizedDepartmentIds.length) {
          const foundIds = departments.map(d => d.id);
          const missingIds = normalizedDepartmentIds.filter(id => !foundIds.includes(id));
          throw ApiError.badRequest(`Departments not found: ${missingIds.join(', ')}`);
        }

        const inactiveDepartments = departments.filter(d => !d.isActive);
        if (inactiveDepartments.length > 0) {
          const deptNames = inactiveDepartments.map(d => d.name).join(', ');
          logger.warn('Attempting to assign to inactive departments:', { deptNames });
          throw ApiError.badRequest(
            `Cannot assign to inactive departments: ${deptNames}`
          );
        }
      }

      // Validate individual students exist and have active enrollments if applicable (Issue #27)
      if (normalizedStudentIds !== undefined && normalizedStudentIds.length > 0) {
        const students = await prisma.user.findMany({
          where: { 
            id: { in: normalizedStudentIds },
            role: 'student'
          },
          select: { id: true, firstName: true, lastName: true },
        });

        if (students.length !== normalizedStudentIds.length) {
          const foundIds = students.map(s => s.id);
          const missingIds = normalizedStudentIds.filter(id => !foundIds.includes(id));
          throw ApiError.badRequest(`Students not found or not student role: ${missingIds.join(', ')}`);
        }

        // If assigning to a course, verify students are enrolled
        if (exam.courseId) {
          const enrollments = await prisma.studentEnrollment.findMany({
            where: {
              studentId: { in: normalizedStudentIds },
              courseId: exam.courseId,
              status: 'enrolled'
            },
            select: { studentId: true },
          });

          const enrolledIds = enrollments.map(e => e.studentId);
          const notEnrolledIds = normalizedStudentIds.filter(id => !enrolledIds.includes(id));
          if (notEnrolledIds.length > 0) {
            const notEnrolledStudents = students
              .filter(s => notEnrolledIds.includes(s.id))
              .map(s => `${s.firstName} ${s.lastName}`)
              .join(', ');
            throw ApiError.badRequest(
              `Students not enrolled in course: ${notEnrolledStudents}. Enroll them first.`
            );
          }
        }
      }

    // Use a batched transaction (array form) to avoid long interactive transaction timeouts.
    const txOps = [];

    if (normalizedSectionIds !== undefined) {
      txOps.push(prisma.examSection.deleteMany({ where: { examId } }));
      if (normalizedSectionIds.length > 0) {
        txOps.push(
          prisma.examSection.createMany({
            data: normalizedSectionIds.map((sectionId) => ({ examId, sectionId })),
            skipDuplicates: true,
          })
        );
      }
    }

    if (normalizedDepartmentIds !== undefined) {
      txOps.push(prisma.examDepartment.deleteMany({ where: { examId } }));
      if (normalizedDepartmentIds.length > 0) {
        txOps.push(
          prisma.examDepartment.createMany({
            data: normalizedDepartmentIds.map((departmentId) => ({ examId, departmentId })),
            skipDuplicates: true,
          })
        );
      }
    }

    if (normalizedStudentIds !== undefined) {
      txOps.push(prisma.examStudent.deleteMany({ where: { examId } }));
      if (normalizedStudentIds.length > 0) {
        txOps.push(
          prisma.examStudent.createMany({
            data: normalizedStudentIds.map((studentId) => ({ examId, studentId })),
            skipDuplicates: true,
          })
        );
      }
    }

    if (assignmentMode) {
      txOps.push(prisma.exam.update({ where: { id: examId }, data: { assignmentMode } }));
    }

    if (txOps.length > 0) {
      await prisma.$transaction(txOps);
    }

    if (normalizedSectionIds !== undefined) {
      logger.info(`Updated section assignments count: ${normalizedSectionIds.length}`);
    }
    if (normalizedDepartmentIds !== undefined) {
      logger.info(`Updated department assignments count: ${normalizedDepartmentIds.length}`);
    }
    if (normalizedStudentIds !== undefined) {
      logger.info(`Updated student assignments count: ${normalizedStudentIds.length}`);
    }
    if (assignmentMode) {
      logger.info(`Updated assignment mode to: ${assignmentMode}`);
    }

    const updated = await prisma.exam.findUnique({
      where: { id: examId },
      include: this.buildExamIncludes(false),
    });

    await invalidateExamCache(examId, exam.institutionId).catch((error) => {
      logger.warn('Failed to invalidate cache on assign', { examId, error: error.message });
    });

    if (getFlagValue('websocketNotifications')) {
      notifyInstitution(exam.institutionId, 'exam:assignment_updated', {
        examId,
        assignmentMode: updated.assignmentMode,
      });

      if (Array.isArray(normalizedStudentIds) && normalizedStudentIds.length > 0) {
        await Promise.all(
          normalizedStudentIds.map((studentId) =>
            createNotification({
              userId: studentId,
              courseId: exam.courseId,
              notificationType: 'exam_reminder',
              title: 'New Exam Assigned',
              message: `A new exam has been assigned to you. Please check your exams dashboard.`,
              priority: 'medium',
              actionUrl: `/student/exam/${examId}`,
              metadata: { examId },
            }).catch((error) => {
              logger.warn('Failed to create assignment notification', {
                examId,
                studentId,
                error: error.message,
              });
            })
          )
        );
      }
    }
    logger.info('Exam assignment completed:', {
      examId,
      assignedSections: updated.examSections?.map(s => s.sectionId),
      assignedDepartments: updated.examDepartments?.map(d => d.departmentId),
      assignmentMode: updated.assignmentMode,
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