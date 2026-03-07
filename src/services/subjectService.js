/**
 * 🎓 Academic Intelligence Platform - Subject Service
 * Subject management
 */

const { prisma } = require('../config/database');
const { ApiError, buildPaginationMeta, paginate } = require('../utils/helpers');
const logger = require('../utils/logger');

class SubjectService {
  /**
   * Get all subjects
   */
  async getSubjects(options = {}) {
    const { page, limit, institutionId, simple } = options;
    const pagination = paginate(page, limit);

    const where = institutionId ? { institutionId } : {};

    const total = await prisma.subject.count({ where });

    const subjects = await prisma.subject.findMany({
      where,
      ...(simple
        ? {
            select: {
              id: true,
              name: true,
              code: true,
              description: true,
              department: true,
              institutionId: true,
              createdAt: true,
              updatedAt: true,
            },
          }
        : {
            include: {
              _count: {
                select: { chapters: true, questions: true, courses: true },
              },
            },
          }),
      orderBy: { name: 'asc' },
      skip: pagination.offset,
      take: pagination.limit,
    });

    return {
      subjects: subjects.map(s => this.formatSubjectResponse(s)),
      meta: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  /**
   * Get subject by ID
   */
  async getSubjectById(subjectId) {
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      include: {
        _count: {
          select: { chapters: true, questions: true, courses: true },
        },
      },
    });

    if (!subject) {
      throw ApiError.notFound('Subject not found');
    }

    return this.formatSubjectResponse(subject);
  }

  /**
   * Format subject response
   */
  formatSubjectResponse(subject) {
    return {
      id: subject.id,
      name: subject.name,
      code: subject.code,
      description: subject.description,
      department: subject.department,
      institutionId: subject.institutionId,
      chapterCount: subject._count?.chapters || 0,
      questionCount: subject._count?.questions || 0,
      courseCount: subject._count?.courses || 0,
      createdAt: subject.createdAt,
      updatedAt: subject.updatedAt,
    };
  }
}

module.exports = new SubjectService();
