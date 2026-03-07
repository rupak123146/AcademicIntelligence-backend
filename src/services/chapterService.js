/**
 * 🎓 Academic Intelligence Platform - Chapter Service
 * Chapter management for subjects
 */

const { prisma } = require('../config/database');
const { ApiError, buildPaginationMeta, paginate } = require('../utils/helpers');
const logger = require('../utils/logger');

class ChapterService {
  /**
   * Create a new chapter
   */
  async createChapter(data, userId) {
    const { subjectId, name, chapterNumber, description } = data;

    // Validate subject exists
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      throw ApiError.notFound('Subject not found');
    }

    // Check if chapter number already exists for this subject
    const existingChapter = await prisma.chapter.findFirst({
      where: {
        subjectId,
        chapterNumber,
      },
    });
    if (existingChapter) {
      throw ApiError.badRequest(`Chapter number ${chapterNumber} already exists for this subject`);
    }

    const chapter = await prisma.chapter.create({
      data: {
        subjectId,
        name,
        chapterNumber,
        description: description || null,
      },
      include: {
        subject: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { concepts: true, questions: true },
        },
      },
    });

    logger.info('Chapter created:', { chapterId: chapter.id, userId });
    return this.formatChapterResponse(chapter);
  }

  /**
   * Get chapters by subject ID
   */
  async getChaptersBySubject(subjectId, options = {}) {
    const { page, limit, simple } = options;
    const pagination = paginate(page, limit);

    // Validate subject exists
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      throw ApiError.notFound('Subject not found');
    }

    const where = { subjectId };

    const total = await prisma.chapter.count({ where });

    const chapters = await prisma.chapter.findMany({
      where,
      ...(simple
        ? {
            select: {
              id: true,
              subjectId: true,
              name: true,
              chapterNumber: true,
              description: true,
              createdAt: true,
              updatedAt: true,
            },
          }
        : {
            include: {
              subject: {
                select: { id: true, name: true, code: true },
              },
              _count: {
                select: { concepts: true, questions: true },
              },
            },
          }),
      orderBy: { chapterNumber: 'asc' },
      skip: pagination.offset,
      take: pagination.limit,
    });

    return {
      chapters: chapters.map(c => this.formatChapterResponse(c)),
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  /**
   * Get chapter by ID
   */
  async getChapterById(chapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        subject: {
          select: { id: true, name: true, code: true },
        },
        concepts: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            difficultyLevel: true,
          },
        },
        _count: {
          select: { questions: true },
        },
      },
    });

    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }

    return this.formatChapterResponse(chapter);
  }

  /**
   * Update chapter
   */
  async updateChapter(chapterId, data) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
    });
    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }

    // If updating chapter number, check for conflicts
    if (data.chapterNumber && data.chapterNumber !== chapter.chapterNumber) {
      const existing = await prisma.chapter.findFirst({
        where: {
          subjectId: chapter.subjectId,
          chapterNumber: data.chapterNumber,
          id: { not: chapterId },
        },
      });
      if (existing) {
        throw ApiError.badRequest(`Chapter number ${data.chapterNumber} already exists for this subject`);
      }
    }

    const allowedFields = ['name', 'chapterNumber', 'description'];
    const updatePayload = {};
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        updatePayload[field] = data[field];
      }
    });

    const updated = await prisma.chapter.update({
      where: { id: chapterId },
      data: updatePayload,
      include: {
        subject: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { concepts: true, questions: true },
        },
      },
    });

    logger.info('Chapter updated:', { chapterId });
    return this.formatChapterResponse(updated);
  }

  /**
   * Delete chapter
   */
  async deleteChapter(chapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        _count: {
          select: { questions: true, concepts: true },
        },
      },
    });

    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }

    // Check if chapter has associated questions or concepts
    if (chapter._count.questions > 0) {
      throw ApiError.badRequest('Cannot delete chapter with existing questions. Remove questions first.');
    }
    if (chapter._count.concepts > 0) {
      throw ApiError.badRequest('Cannot delete chapter with existing concepts. Remove concepts first.');
    }

    await prisma.chapter.delete({
      where: { id: chapterId },
    });

    logger.info('Chapter deleted:', { chapterId });
    return true;
  }

  /**
   * Format chapter response
   */
  formatChapterResponse(chapter) {
    return {
      id: chapter.id,
      subjectId: chapter.subjectId,
      subjectName: chapter.subject?.name,
      subjectCode: chapter.subject?.code,
      name: chapter.name,
      chapterNumber: chapter.chapterNumber,
      description: chapter.description,
      conceptCount: chapter._count?.concepts || chapter.concepts?.length || 0,
      questionCount: chapter._count?.questions || 0,
      concepts: chapter.concepts || undefined,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt,
    };
  }
}

module.exports = new ChapterService();
