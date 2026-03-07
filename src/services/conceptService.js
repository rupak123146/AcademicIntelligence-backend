/**
 * 🎓 Academic Intelligence Platform - Concept Service
 * Concept management for chapters
 */

const { prisma } = require('../config/database');
const { ApiError, buildPaginationMeta, paginate } = require('../utils/helpers');
const logger = require('../utils/logger');

class ConceptService {
  /**
   * Create a new concept
   */
  async createConcept(data, userId) {
    const { chapterId, name, description, difficultyLevel } = data;

    // Validate chapter exists
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { subject: true },
    });
    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }

    // Check if concept name already exists for this chapter
    const existingConcept = await prisma.concept.findFirst({
      where: {
        chapterId,
        name,
      },
    });
    if (existingConcept) {
      throw ApiError.badRequest(`Concept "${name}" already exists for this chapter`);
    }

    const concept = await prisma.concept.create({
      data: {
        chapterId,
        name,
        description: description || null,
        difficultyLevel: difficultyLevel || null,
      },
      include: {
        chapter: {
          select: { 
            id: true, 
            name: true, 
            chapterNumber: true,
            subject: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        _count: {
          select: { questions: true },
        },
      },
    });

    logger.info('Concept created:', { conceptId: concept.id, userId });
    return this.formatConceptResponse(concept);
  }

  /**
   * Get concepts by chapter ID
   */
  async getConceptsByChapter(chapterId, options = {}) {
    const { page, limit, simple } = options;
    const pagination = paginate(page, limit);

    // Validate chapter exists
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
    });
    if (!chapter) {
      throw ApiError.notFound('Chapter not found');
    }

    const where = { chapterId };

    const total = await prisma.concept.count({ where });

    const concepts = await prisma.concept.findMany({
      where,
      ...(simple
        ? {
            select: {
              id: true,
              chapterId: true,
              name: true,
              description: true,
              difficultyLevel: true,
              createdAt: true,
              updatedAt: true,
            },
          }
        : {
            include: {
              chapter: {
                select: {
                  id: true,
                  name: true,
                  chapterNumber: true,
                  subject: {
                    select: { id: true, name: true, code: true },
                  },
                },
              },
              _count: {
                select: { questions: true },
              },
            },
          }),
      orderBy: { name: 'asc' },
      skip: pagination.offset,
      take: pagination.limit,
    });

    return {
      concepts: concepts.map(c => this.formatConceptResponse(c)),
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  /**
   * Get concept by ID
   */
  async getConceptById(conceptId) {
    const concept = await prisma.concept.findUnique({
      where: { id: conceptId },
      include: {
        chapter: {
          select: { 
            id: true, 
            name: true, 
            chapterNumber: true,
            subject: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        _count: {
          select: { questions: true },
        },
      },
    });

    if (!concept) {
      throw ApiError.notFound('Concept not found');
    }

    return this.formatConceptResponse(concept);
  }

  /**
   * Update concept
   */
  async updateConcept(conceptId, data) {
    const concept = await prisma.concept.findUnique({
      where: { id: conceptId },
    });
    if (!concept) {
      throw ApiError.notFound('Concept not found');
    }

    // If updating name, check for conflicts
    if (data.name && data.name !== concept.name) {
      const existing = await prisma.concept.findFirst({
        where: {
          chapterId: concept.chapterId,
          name: data.name,
          id: { not: conceptId },
        },
      });
      if (existing) {
        throw ApiError.badRequest(`Concept "${data.name}" already exists for this chapter`);
      }
    }

    const allowedFields = ['name', 'description', 'difficultyLevel'];
    const updatePayload = {};
    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        updatePayload[field] = data[field];
      }
    });

    const updated = await prisma.concept.update({
      where: { id: conceptId },
      data: updatePayload,
      include: {
        chapter: {
          select: { 
            id: true, 
            name: true, 
            chapterNumber: true,
            subject: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        _count: {
          select: { questions: true },
        },
      },
    });

    logger.info('Concept updated:', { conceptId });
    return this.formatConceptResponse(updated);
  }

  /**
   * Delete concept
   */
  async deleteConcept(conceptId) {
    const concept = await prisma.concept.findUnique({
      where: { id: conceptId },
      include: {
        _count: {
          select: { questions: true },
        },
      },
    });

    if (!concept) {
      throw ApiError.notFound('Concept not found');
    }

    // Check if concept has associated questions
    if (concept._count.questions > 0) {
      throw ApiError.badRequest('Cannot delete concept with existing questions. Remove questions first.');
    }

    await prisma.concept.delete({
      where: { id: conceptId },
    });

    logger.info('Concept deleted:', { conceptId });
    return true;
  }

  /**
   * Format concept response
   */
  formatConceptResponse(concept) {
    return {
      id: concept.id,
      chapterId: concept.chapterId,
      chapterName: concept.chapter?.name,
      chapterNumber: concept.chapter?.chapterNumber,
      subjectId: concept.chapter?.subject?.id,
      subjectName: concept.chapter?.subject?.name,
      name: concept.name,
      description: concept.description,
      difficultyLevel: concept.difficultyLevel,
      questionCount: concept._count?.questions || 0,
      createdAt: concept.createdAt,
      updatedAt: concept.updatedAt,
    };
  }
}

module.exports = new ConceptService();
