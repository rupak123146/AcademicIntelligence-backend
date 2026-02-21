/**
 * 🎓 Academic Intelligence Platform - Question Service
 * Question bank management
 */

const { prisma } = require('../config/database');
const { ApiError, paginate, buildPaginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');

class QuestionService {
  /**
   * Create a new question
   */
  async createQuestion(data, creatorId) {
    const {
      questionText,
      questionType,
      subjectId,
      chapterId,
      conceptId,
      options,
      correctAnswer,
      explanation,
      difficulty,
      marks,
      negativeMarks,
      tags,
    } = data;

    // Validate subject exists
    if (subjectId) {
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId },
      });
      if (!subject) {
        throw ApiError.notFound('Subject not found');
      }
    }

    // Validate chapter exists
    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapter) {
        throw ApiError.notFound('Chapter not found');
      }
    }

    // Validate options for MCQ
    if (['mcq', 'multiple'].includes(questionType)) {
      if (!options || options.length < 2) {
        throw ApiError.badRequest('MCQ questions must have at least 2 options');
      }
      const hasCorrectOption = options.some(opt => opt.isCorrect);
      if (!hasCorrectOption) {
        throw ApiError.badRequest('At least one option must be marked as correct');
      }
    }

    const question = await prisma.question.create({
      data: {
        questionText,
        questionType,
        subjectId: subjectId || undefined,
        chapterId: chapterId || undefined,
        conceptId: conceptId || undefined,
        correctAnswer: ['mcq', 'multiple', 'multiple_choice'].includes(questionType)
          ? null
          : correctAnswer,
        explanation,
        difficulty: difficulty || 'medium',
        marks: marks || 1,
        negativeMarks: negativeMarks || 0,
        tags: tags || [],
        createdById: creatorId,
        isActive: true,
        options: options?.length
          ? {
            create: options.map((opt) => ({
              text: opt.text || opt.optionText,
              isCorrect: !!opt.isCorrect,
            })),
          }
          : undefined,
      },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        chapter: { select: { id: true, name: true, chapterNumber: true } },
        concept: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        options: true,
      },
    });

    logger.info('Question created:', { questionId: question.id, creatorId });

    return this.formatQuestionResponse(question);
  }

  /**
   * Get questions with filters
   */
  async getQuestions(filters, userId) {
    const { subjectId, chapterId, conceptId, difficulty, questionType, search, page, limit } = filters;
    const pagination = paginate(page, limit);

    const query = { isActive: true };

    // Get user to filter by institution
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { institutionId: true },
    });
    
    if (subjectId) query.subjectId = subjectId;
    if (chapterId) query.chapterId = chapterId;
    if (conceptId) query.conceptId = conceptId;
    if (difficulty) query.difficulty = difficulty;
    if (questionType) query.questionType = questionType;

    if (search) {
      query.OR = [
        { questionText: { contains: search, mode: 'insensitive' } },
      ];
    }

    const total = await prisma.question.count({ where: query });

    const questions = await prisma.question.findMany({
      where: query,
      include: {
        subject: { select: { id: true, name: true, code: true } },
        chapter: { select: { id: true, name: true, chapterNumber: true } },
        concept: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        options: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: pagination.offset,
      take: pagination.limit,
    });

    const formattedQuestions = questions.map(q => this.formatQuestionResponse(q));

    return {
      questions: formattedQuestions,
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  /**
   * Get question by ID
   */
  async getQuestionById(questionId, userId) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        chapter: { select: { id: true, name: true, chapterNumber: true } },
        concept: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        options: true,
      },
    });

    if (!question) {
      throw ApiError.notFound('Question not found');
    }

    return this.formatQuestionResponse(question);
  }

  /**
   * Update question
   */
  async updateQuestion(questionId, data, userId) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { options: true },
    });
    if (!question) {
      throw ApiError.notFound('Question not found');
    }

    // Check ownership
    if (question.createdById !== userId) {
      // Check if user is admin
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user.role !== 'admin') {
        throw ApiError.forbidden('You can only update your own questions');
      }
    }

    // Update fields
    const allowedFields = [
      'questionText', 'questionType', 'subjectId', 'chapterId', 'conceptId',
      'options', 'correctAnswer', 'explanation', 'difficulty', 'marks', 
      'negativeMarks', 'tags', 'isActive'
    ];

    const updatePayload = {};
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        if (field !== 'options') {
          updatePayload[field] = data[field];
        }
      }
    });

    const updated = await prisma.question.update({
      where: { id: questionId },
      data: {
        ...updatePayload,
        options: data.options
          ? {
            deleteMany: {},
            create: data.options.map((opt) => ({
              text: opt.text || opt.optionText,
              isCorrect: !!opt.isCorrect,
            })),
          }
          : undefined,
      },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        chapter: { select: { id: true, name: true, chapterNumber: true } },
        concept: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        options: true,
      },
    });

    logger.info('Question updated:', { questionId, userId });

    return this.formatQuestionResponse(updated);
  }

  /**
   * Delete question
   */
  async deleteQuestion(questionId, userId) {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw ApiError.notFound('Question not found');
    }

    // Check ownership
    if (question.createdById !== userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user.role !== 'admin') {
        throw ApiError.forbidden('You can only delete your own questions');
      }
    }

    // Soft delete
    await prisma.question.update({
      where: { id: questionId },
      data: { isActive: false },
    });

    logger.info('Question deleted:', { questionId, userId });
    return true;
  }

  /**
   * Bulk create questions
   */
  async bulkCreateQuestions(questions, creatorId) {
    const createdQuestions = [];
    
    for (const data of questions) {
      const question = await this.createQuestion(data, creatorId);
      createdQuestions.push(question);
    }

    logger.info('Bulk questions created:', { count: createdQuestions.length, creatorId });
    return createdQuestions;
  }

  /**
   * Get questions by IDs
   */
  async getQuestionsByIds(questionIds) {
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds }, isActive: true },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        chapter: { select: { id: true, name: true, chapterNumber: true } },
        concept: { select: { id: true, name: true } },
        options: true,
      },
    });

    return questions.map(q => this.formatQuestionResponse(q));
  }

  /**
   * Format question response
   */
  formatQuestionResponse(question) {
    return {
      id: question.id,
      questionText: question.questionText,
      questionType: question.questionType,
      subjectId: question.subject?.id || question.subjectId,
      subjectName: question.subject?.name,
      chapterId: question.chapter?.id || question.chapterId,
      chapterName: question.chapter?.name,
      conceptId: question.concept?.id || question.conceptId,
      conceptName: question.concept?.name,
      options: question.options?.map((opt) => ({
        id: opt.id,
        text: opt.text,
        optionText: opt.text,
        isCorrect: opt.isCorrect,
      })),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      difficulty: question.difficulty,
      marks: question.marks,
      negativeMarks: question.negativeMarks,
      tags: question.tags,
      createdBy: question.createdBy?.id || question.createdById,
      creatorName: question.createdBy?.firstName
        ? `${question.createdBy.firstName} ${question.createdBy.lastName}`
        : null,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
    };
  }
}

module.exports = new QuestionService();
