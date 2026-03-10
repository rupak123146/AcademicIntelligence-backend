/**
 * 🎓 Academic Intelligence Platform - Question Service
 * Question bank management
 */

const { prisma } = require('../config/database');
const { ApiError, paginate, buildPaginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');

class QuestionService {
  /**
   * Validate question options by type
   */
  validateQuestionOptions(questionType, options, correctAnswer) {
    const mcqTypes = ['mcq', 'multiple', 'multiple_choice'];
    const tfTypes = ['true_false', 'boolean'];
    const subjectiveTypes = ['short_answer', 'essay', 'descriptive'];

    if (mcqTypes.includes(questionType)) {
      if (!Array.isArray(options) || options.length < 2) {
        throw ApiError.badRequest('MCQ questions must have at least 2 options');
      }
      if (options.length > 10) {
        throw ApiError.badRequest('MCQ questions cannot have more than 10 options');
      }
      const correctCount = options.filter((opt) => !!opt.isCorrect).length;
      if (correctCount < 1) {
        throw ApiError.badRequest('At least one option must be marked as correct');
      }
      if (correctCount > 5) {
        throw ApiError.badRequest('MCQ cannot have more than 5 correct answers');
      }
    }

    if (tfTypes.includes(questionType)) {
      if (!Array.isArray(options) || options.length !== 2) {
        throw ApiError.badRequest('True/False questions must have exactly 2 options');
      }
      const optionTexts = options
        .map((o) => (o.text || o.optionText || '').trim().toLowerCase())
        .filter(Boolean);
      const validPair =
        (optionTexts.includes('true') && optionTexts.includes('false')) ||
        (optionTexts.includes('yes') && optionTexts.includes('no'));
      if (!validPair) {
        throw ApiError.badRequest('True/False options must be "True/False" or "Yes/No"');
      }
      const correctCount = options.filter((opt) => !!opt.isCorrect).length;
      if (correctCount !== 1) {
        throw ApiError.badRequest('True/False questions must have exactly one correct option');
      }
    }

    if (subjectiveTypes.includes(questionType)) {
      if (Array.isArray(options) && options.length > 0) {
        logger.warn('Subjective question received options; they will be ignored', { questionType });
      }
      if (!correctAnswer || String(correctAnswer).trim().length < 5) {
        throw ApiError.badRequest('Subjective questions must have a sample answer of at least 5 characters');
      }
      if (String(correctAnswer).length > 2000) {
        throw ApiError.badRequest('Sample correct answer cannot exceed 2000 characters');
      }
    }
  }

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

    if (!subjectId || !chapterId || !conceptId) {
      throw ApiError.badRequest('Subject, chapter, and concept are mandatory for performance tracking');
    }

    // Validate taxonomy and hierarchy integrity
    const [subject, chapter, concept] = await Promise.all([
      prisma.subject.findUnique({ where: { id: subjectId } }),
      prisma.chapter.findUnique({ where: { id: chapterId } }),
      prisma.concept.findUnique({ where: { id: conceptId } }),
    ]);

    if (!subject) {
      throw ApiError.notFound('Subject not found');
    }
    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }
    if (!concept) {
      throw ApiError.notFound('Concept not found');
    }
    if (chapter.subjectId !== subjectId) {
      throw ApiError.badRequest('Selected chapter does not belong to selected subject');
    }
    if (concept.chapterId !== chapterId) {
      throw ApiError.badRequest('Selected concept does not belong to selected chapter');
    }

    this.validateQuestionOptions(questionType, options, correctAnswer);

    const question = await prisma.question.create({
      data: {
        questionText,
        questionType,
        subjectId: subjectId || undefined,
        chapterId: chapterId || undefined,
        conceptId: conceptId || undefined,
        correctAnswer: ['mcq', 'multiple', 'multiple_choice', 'true_false'].includes(questionType)
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

    const finalSubjectId = data.subjectId !== undefined ? data.subjectId : question.subjectId;
    const finalChapterId = data.chapterId !== undefined ? data.chapterId : question.chapterId;
    const finalConceptId = data.conceptId !== undefined ? data.conceptId : question.conceptId;

    if (!finalSubjectId || !finalChapterId || !finalConceptId) {
      throw ApiError.badRequest('Subject, chapter, and concept are mandatory for performance tracking');
    }

    const [subject, chapter, concept] = await Promise.all([
      prisma.subject.findUnique({ where: { id: finalSubjectId } }),
      prisma.chapter.findUnique({ where: { id: finalChapterId } }),
      prisma.concept.findUnique({ where: { id: finalConceptId } }),
    ]);

    if (!subject) {
      throw ApiError.notFound('Subject not found');
    }
    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }
    if (!concept) {
      throw ApiError.notFound('Concept not found');
    }
    if (chapter.subjectId !== finalSubjectId) {
      throw ApiError.badRequest('Selected chapter does not belong to selected subject');
    }
    if (concept.chapterId !== finalChapterId) {
      throw ApiError.badRequest('Selected concept does not belong to selected chapter');
    }

    const finalQuestionType = data.questionType !== undefined ? data.questionType : question.questionType;
    const finalOptions = data.options !== undefined ? data.options : question.options;
    const finalCorrectAnswer = data.correctAnswer !== undefined ? data.correctAnswer : question.correctAnswer;
    this.validateQuestionOptions(finalQuestionType, finalOptions, finalCorrectAnswer);

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
