/**
 * 🎓 Academic Intelligence Platform - Analytics Service (SQL/Prisma)
 * Analytics and reporting using MySQL
 */

const { prisma } = require('../config/database');
const { setCache, getCache, CacheKeys } = require('../config/redis');
const { ApiError, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class AnalyticsService {
  /**
   * Get student dashboard analytics
   */
  async getStudentDashboard(studentId, courseId = null) {
    const cacheKey = courseId
      ? `analytics:dashboard:${studentId}:${courseId}`
      : `analytics:dashboard:${studentId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const overview = await this.getStudentOverview(studentId, courseId);
    const recentPerformance = await this.getRecentPerformance(studentId, courseId, 5);
    const performanceTrend = await this.getPerformanceTrend(studentId, courseId);
    const chapterAnalysis = await this.getChapterAnalysis(studentId, courseId);

    const dashboard = {
      overview,
      recentPerformance,
      performanceTrend,
      chapterAnalysis,
      generatedAt: new Date(),
    };

    await setCache(cacheKey, dashboard, 300);
    return dashboard;
  }

  /**
   * Get student overview stats
   */
  async getStudentOverview(studentId, courseId = null) {
    const query = {
      studentId,
      status: { in: ['submitted', 'auto_submitted', 'graded'] },
    };

    if (courseId) {
      const exams = await prisma.exam.findMany({
        where: { courseId },
        select: { id: true },
      });
      query.examId = { in: exams.map((e) => e.id) };
    }

    const attempts = await prisma.examAttempt.findMany({ where: query });

    if (attempts.length === 0) {
      return {
        totalExams: 0,
        avgScore: 0,
        avgPercentage: 0,
        totalCorrect: 0,
        totalWrong: 0,
        totalSkipped: 0,
        passRate: 0,
      };
    }

    const totalExams = attempts.length;
    const avgScore = attempts.reduce((sum, a) => sum + a.totalScore, 0) / totalExams;
    const avgPercentage = attempts.reduce((sum, a) => sum + a.percentage, 0) / totalExams;
    const totalCorrect = attempts.reduce((sum, a) => sum + a.correctAnswers, 0);
    const totalWrong = attempts.reduce((sum, a) => sum + a.wrongAnswers, 0);
    const totalSkipped = attempts.reduce((sum, a) => sum + a.skipped, 0);
    const passedCount = attempts.filter((a) => a.passed).length;

    return {
      totalExams,
      avgScore: Math.round(avgScore * 100) / 100,
      avgPercentage: Math.round(avgPercentage * 100) / 100,
      totalCorrect,
      totalWrong,
      totalSkipped,
      passRate: calculatePercentage(passedCount, totalExams),
    };
  }

  /**
   * Get recent exam performance
   */
  async getRecentPerformance(studentId, courseId = null, limit = 5) {
    const query = {
      studentId,
      status: { in: ['submitted', 'auto_submitted', 'graded'] },
    };

    if (courseId) {
      const exams = await prisma.exam.findMany({
        where: { courseId },
        select: { id: true },
      });
      query.examId = { in: exams.map((e) => e.id) };
    }

    const attempts = await prisma.examAttempt.findMany({
      where: query,
      orderBy: { submittedAt: 'desc' },
      take: limit,
      include: { exam: { select: { id: true, title: true } } },
    });

    return attempts.map((a) => ({
      examId: a.exam.id,
      examTitle: a.exam.title,
      score: a.totalScore,
      percentage: a.percentage,
      grade: a.grade,
      passed: a.passed,
      submittedAt: a.submittedAt,
    }));
  }

  /**
   * Get performance trend over time
   */
  async getPerformanceTrend(studentId, courseId = null) {
    const query = {
      studentId,
      status: { in: ['submitted', 'auto_submitted', 'graded'] },
    };

    if (courseId) {
      const exams = await prisma.exam.findMany({
        where: { courseId },
        select: { id: true },
      });
      query.examId = { in: exams.map((e) => e.id) };
    }

    const attempts = await prisma.examAttempt.findMany({
      where: query,
      orderBy: { submittedAt: 'asc' },
      take: 10,
    });

    return attempts.map((a, index) => ({
      attemptNumber: index + 1,
      percentage: a.percentage,
      date: a.submittedAt,
    }));
  }

  /**
   * Get chapter-wise analysis
   */
  async getChapterAnalysis(studentId, courseId = null) {
    const attempts = await prisma.examAttempt.findMany({
      where: { studentId, status: { in: ['submitted', 'auto_submitted', 'graded'] } },
      select: { id: true },
    });

    if (attempts.length === 0) return [];

    const attemptIds = attempts.map((a) => a.id);
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId: { in: attemptIds } },
      include: {
        question: { include: { chapter: { select: { name: true } } } },
      },
    });

    const chapterStats = {};
    for (const answer of answers) {
      const chapter = answer.question?.chapter;
      if (!chapter) continue;

      const chapterName = chapter.name;
      if (!chapterStats[chapterName]) {
        chapterStats[chapterName] = { correct: 0, total: 0 };
      }
      chapterStats[chapterName].total++;
      if (answer.isCorrect) chapterStats[chapterName].correct++;
    }

    return Object.entries(chapterStats).map(([name, stats]) => ({
      chapter: name,
      accuracy: calculatePercentage(stats.correct, stats.total),
      totalQuestions: stats.total,
      correctAnswers: stats.correct,
    }));
  }

  /**
   * Get educator class analytics
   */
  async getClassAnalytics(courseId = null, examId = null, educatorId = null) {
    let educatorSections = [];
    if (educatorId) {
      const sectionLinks = await prisma.educatorSection.findMany({
        where: { educatorId },
        select: { sectionId: true },
      });
      educatorSections = sectionLinks.map((s) => s.sectionId);
    }

    const studentsQuery = { role: 'student', isActive: true };
    if (educatorSections.length > 0) {
      studentsQuery.sectionId = { in: educatorSections };
    }

    const students = await prisma.user.findMany({
      where: studentsQuery,
      include: {
        department: { select: { name: true, code: true } },
        section: { select: { name: true, code: true } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        studentId: true,
        rollNumber: true,
        profileCompleted: true,
        currentSemester: true,
        department: true,
        section: true,
      },
    });

    const totalStudents = students.length;

    let exams;
    if (examId) {
      exams = await prisma.exam.findMany({ where: { id: examId } });
    } else if (educatorId) {
      exams = await prisma.exam.findMany({ where: { createdById: educatorId } });
    } else {
      exams = await prisma.exam.findMany();
    }

    const examIds = exams.map((e) => e.id);
    const totalExams = exams.length;

    const allAttempts = await prisma.examAttempt.findMany({
      where: {
        examId: { in: examIds },
        status: { in: ['submitted', 'auto_submitted', 'graded'] },
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, email: true } },
        exam: { select: { id: true, title: true } },
      },
    });

    const avgScore = allAttempts.length > 0
      ? allAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / allAttempts.length
      : 0;
    const passRate = allAttempts.length > 0
      ? calculatePercentage(allAttempts.filter((a) => a.passed).length, allAttempts.length)
      : 0;

    const studentPerformanceMap = {};
    for (const attempt of allAttempts) {
      const attemptStudentId = attempt.student?.id;
      if (!attemptStudentId) continue;

      if (!studentPerformanceMap[attemptStudentId]) {
        studentPerformanceMap[attemptStudentId] = {
          id: attemptStudentId,
          firstName: attempt.student.firstName,
          lastName: attempt.student.lastName,
          email: attempt.student.email,
          scores: [],
          examsAttempted: 0,
          totalCorrect: 0,
          totalWrong: 0,
          passed: 0,
          failed: 0,
        };
      }
      studentPerformanceMap[attemptStudentId].scores.push(attempt.percentage || 0);
      studentPerformanceMap[attemptStudentId].examsAttempted++;
      studentPerformanceMap[attemptStudentId].totalCorrect += attempt.correctAnswers || 0;
      studentPerformanceMap[attemptStudentId].totalWrong += attempt.wrongAnswers || 0;
      if (attempt.passed) {
        studentPerformanceMap[attemptStudentId].passed++;
      } else {
        studentPerformanceMap[attemptStudentId].failed++;
      }
    }

    const studentPerformance = Object.values(studentPerformanceMap).map((s) => {
      const avg = s.scores.length > 0 ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length : 0;
      const scores = [...s.scores].sort((a, b) => b - a);
      const trend = scores.length >= 2 ? scores[0] - scores[scores.length - 1] : 0;

      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        averageScore: Math.round(avg * 100) / 100,
        examsAttempted: s.examsAttempted,
        examsTaken: s.examsAttempted,
        totalExams,
        passRate: s.examsAttempted > 0
          ? Math.round((s.passed / s.examsAttempted) * 100)
          : 0,
        totalCorrect: s.totalCorrect,
        totalWrong: s.totalWrong,
        trend: Math.round(trend),
        weakArea: avg < 50 ? 'Needs Improvement' : avg < 70 ? 'Average' : 'Good',
      };
    });

    studentPerformance.sort((a, b) => b.averageScore - a.averageScore);

    const atRiskStudents = studentPerformance.filter((s) => s.averageScore < 60);

    const examAnalytics = [];
    for (const exam of exams) {
      const examAttempts = allAttempts.filter((a) => a.exam?.id === exam.id);
      const examAvgScore = examAttempts.length > 0
        ? examAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / examAttempts.length
        : 0;
      const examPassRate = examAttempts.length > 0
        ? calculatePercentage(examAttempts.filter((a) => a.passed).length, examAttempts.length)
        : 0;

      examAnalytics.push({
        examId: exam.id,
        examTitle: exam.title,
        totalAttempts: examAttempts.length,
        totalStudents,
        attendanceRate: totalStudents > 0
          ? Math.round((examAttempts.length / totalStudents) * 100)
          : 0,
        avgScore: Math.round(examAvgScore * 100) / 100,
        passRate: examPassRate,
        highestScore: examAttempts.length > 0
          ? Math.max(...examAttempts.map((a) => a.percentage || 0))
          : 0,
        lowestScore: examAttempts.length > 0
          ? Math.min(...examAttempts.map((a) => a.percentage || 0))
          : 0,
      });
    }

    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const attempt of allAttempts) {
      const p = attempt.percentage || 0;
      if (p >= 90) gradeDistribution.A++;
      else if (p >= 75) gradeDistribution.B++;
      else if (p >= 60) gradeDistribution.C++;
      else if (p >= 40) gradeDistribution.D++;
      else gradeDistribution.F++;
    }

    const performanceByMonth = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthAttempts = allAttempts.filter((a) => {
        const submitDate = a.submittedAt || a.createdAt;
        return submitDate >= date && submitDate < nextDate;
      });

      const monthAvg = monthAttempts.length > 0
        ? monthAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / monthAttempts.length
        : 0;

      performanceByMonth.push({
        month: months[date.getMonth()],
        avgScore: Math.round(monthAvg),
        submissions: monthAttempts.length,
      });
    }

    const strengthAreas = [];
    if (studentPerformance.length > 0) {
      const topStudents = studentPerformance.slice(0, 5);
      strengthAreas.push({
        area: 'Top Performers',
        count: topStudents.length,
        students: topStudents.map((s) => `${s.firstName} ${s.lastName}`),
      });
    }

    const recommendations = [];
    if (atRiskStudents.length > 0) {
      recommendations.push(`${atRiskStudents.length} students need extra attention (scoring below 60%)`);
    }
    if (avgScore < 60) {
      recommendations.push('Consider reviewing difficult topics with the class');
    }
    if (passRate < 70) {
      recommendations.push('Pass rate is below target. Consider providing additional study materials.');
    }
    if (examAnalytics.some((e) => e.attendanceRate < 80)) {
      recommendations.push('Some exams have low attendance. Follow up with absent students.');
    }

    return {
      totalStudents,
      totalExams,
      averageScore: Math.round(avgScore * 100) / 100,
      passRate,
      totalAttempts: allAttempts.length,
      students: studentPerformance,
      atRiskStudents,
      examAnalytics,
      gradeDistribution,
      performanceByMonth,
      strengthAreas,
      recommendations,
      topPerformers: studentPerformance.slice(0, 5),
      needsAttention: atRiskStudents.slice(0, 5),
    };
  }

  /**
   * Get exam analytics
   */
  async getExamAnalytics(examId, userId, userRole) {
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw ApiError.notFound('Exam not found');
    }

    if (userRole === 'educator' && exam.createdById !== userId) {
      throw ApiError.forbidden('Access denied');
    }

    const attempts = await prisma.examAttempt.findMany({
      where: { examId, status: { in: ['submitted', 'auto_submitted', 'graded'] } },
      include: { student: { select: { firstName: true, lastName: true, email: true } } },
    });

    if (attempts.length === 0) {
      return {
        examId,
        examTitle: exam.title,
        totalAttempts: 0,
        avgScore: 0,
        passRate: 0,
        scoreDistribution: [],
        questionAnalysis: [],
      };
    }

    const avgScore = attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length;
    const passRate = calculatePercentage(attempts.filter((a) => a.passed).length, attempts.length);

    const scoreRanges = [
      { range: '0-20', count: 0 },
      { range: '21-40', count: 0 },
      { range: '41-60', count: 0 },
      { range: '61-80', count: 0 },
      { range: '81-100', count: 0 },
    ];
    for (const attempt of attempts) {
      const p = attempt.percentage;
      if (p <= 20) scoreRanges[0].count++;
      else if (p <= 40) scoreRanges[1].count++;
      else if (p <= 60) scoreRanges[2].count++;
      else if (p <= 80) scoreRanges[3].count++;
      else scoreRanges[4].count++;
    }

    const attemptIds = attempts.map((a) => a.id);
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId: { in: attemptIds } },
      include: { question: { select: { id: true, questionText: true } } },
    });

    const questionStats = {};
    for (const answer of answers) {
      const qId = answer.question.id;
      if (!questionStats[qId]) {
        questionStats[qId] = { questionText: answer.question.questionText, correct: 0, total: 0 };
      }
      questionStats[qId].total++;
      if (answer.isCorrect) questionStats[qId].correct++;
    }

    const questionAnalysis = Object.entries(questionStats)
      .map(([id, stats]) => ({
        questionId: id,
        questionText: stats.questionText.substring(0, 100) + '...',
        accuracy: calculatePercentage(stats.correct, stats.total),
        totalAnswered: stats.total,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);

    const leaderboard = attempts
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 10)
      .map((a, rank) => ({
        rank: rank + 1,
        studentName: `${a.student.firstName} ${a.student.lastName}`,
        score: a.totalScore,
        percentage: a.percentage,
        grade: a.grade,
      }));

    return {
      examId,
      examTitle: exam.title,
      totalAttempts: attempts.length,
      avgScore: Math.round(avgScore * 100) / 100,
      passRate,
      scoreDistribution: scoreRanges,
      questionAnalysis,
      leaderboard,
    };
  }

  /**
   * Get difficulty analysis
   */
  async getDifficultyAnalysis(studentId) {
    const attempts = await prisma.examAttempt.findMany({
      where: { studentId, status: { in: ['submitted', 'auto_submitted', 'graded'] } },
      select: { id: true },
    });

    if (attempts.length === 0) return [];

    const attemptIds = attempts.map((a) => a.id);
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId: { in: attemptIds } },
      include: { question: { select: { difficulty: true } } },
    });

    const difficultyStats = { easy: { correct: 0, total: 0 }, medium: { correct: 0, total: 0 }, hard: { correct: 0, total: 0 } };

    for (const answer of answers) {
      const diff = answer.question?.difficulty || 'medium';
      difficultyStats[diff].total++;
      if (answer.isCorrect) difficultyStats[diff].correct++;
    }

    return Object.entries(difficultyStats).map(([difficulty, stats]) => ({
      difficulty,
      accuracy: calculatePercentage(stats.correct, stats.total),
      totalQuestions: stats.total,
      correctAnswers: stats.correct,
    }));
  }

  /**
   * Get learning gaps
   */
  async getLearningGaps(studentId) {
    const chapters = await this.getChapterAnalysis(studentId);
    return chapters
      .filter((c) => c.accuracy < 60)
      .sort((a, b) => a.accuracy - b.accuracy)
      .map((c) => ({
        topic: c.chapter,
        accuracy: c.accuracy,
        recommendation: c.accuracy < 30
          ? 'Needs immediate attention. Review fundamentals.'
          : c.accuracy < 50
            ? 'Moderate gaps. Practice more problems.'
            : 'Minor gaps. Focus on advanced concepts.',
      }));
  }

  /**
   * Get system-wide analytics for admin dashboard
   */
  async getSystemAnalytics() {
    const [totalUsers, totalStudents, totalEducators, totalAdmins] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: 'student', isActive: true } }),
      prisma.user.count({ where: { role: 'educator', isActive: true } }),
      prisma.user.count({ where: { role: 'admin', isActive: true } }),
    ]);

    const activeCourses = await prisma.course.count({ where: { isActive: true } });
    const totalExams = await prisma.exam.count();

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const userGrowthData = await prisma.$queryRaw`
      SELECT YEAR(createdAt) AS year, MONTH(createdAt) AS month, role, COUNT(*) AS count
      FROM users
      WHERE createdAt >= ${sixMonthsAgo}
      GROUP BY year, month, role
      ORDER BY year, month
    `;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const userGrowth = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthData = {
        month: months[date.getMonth()],
        students: 0,
        educators: 0,
      };

      userGrowthData.forEach((item) => {
        if (item.month === date.getMonth() + 1 && item.year === date.getFullYear()) {
          if (item.role === 'student') monthData.students = Number(item.count);
          if (item.role === 'educator') monthData.educators = Number(item.count);
        }
      });

      userGrowth.push(monthData);
    }

    const recentUsers = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { firstName: true, lastName: true, role: true, createdAt: true },
    });

    const recentActivity = recentUsers.map((u) => ({
      action: 'User registered',
      user: `${u.firstName} ${u.lastName}`,
      time: u.createdAt,
      type: u.role,
    }));

    return {
      totalUsers,
      totalStudents,
      totalEducators,
      totalAdmins,
      totalExams,
      activeCourses,
      userGrowth,
      departmentStats: [],
      recentActivity,
    };
  }
}

module.exports = new AnalyticsService();