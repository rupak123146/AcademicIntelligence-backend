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
        question: { 
          include: { 
            chapter: { select: { id: true, name: true, chapterNumber: true } },
            subject: { select: { id: true, name: true, code: true } }
          } 
        },
      },
    });

    const chapterStats = {};
    for (const answer of answers) {
      const chapter = answer.question?.chapter;
      if (!chapter) continue;

      const chapterKey = chapter.id;
      if (!chapterStats[chapterKey]) {
        chapterStats[chapterKey] = { 
          id: chapter.id,
          name: chapter.name, 
          chapterNumber: chapter.chapterNumber,
          subjectId: answer.question?.subject?.id,
          subjectName: answer.question?.subject?.name,
          correct: 0, 
          total: 0 
        };
      }
      chapterStats[chapterKey].total++;
      if (answer.isCorrect) chapterStats[chapterKey].correct++;
    }

    return Object.values(chapterStats).map((stats) => ({
      chapterId: stats.id,
      chapter: stats.name,
      name: stats.name,
      chapterNumber: stats.chapterNumber,
      subjectId: stats.subjectId,
      subjectName: stats.subjectName,
      score: calculatePercentage(stats.correct, stats.total),
      accuracy: calculatePercentage(stats.correct, stats.total),
      totalQuestions: stats.total,
      correctAnswers: stats.correct,
      target: 80,
    }));
  }

  /**
   * Get concept-wise analysis
   */
  async getConceptAnalysis(studentId, courseId = null, chapterId = null) {
    const attempts = await prisma.examAttempt.findMany({
      where: { studentId, status: { in: ['submitted', 'auto_submitted', 'graded'] } },
      select: { id: true },
    });

    if (attempts.length === 0) return [];

    const attemptIds = attempts.map((a) => a.id);
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId: { in: attemptIds } },
      include: {
        question: { 
          include: { 
            concept: { select: { id: true, name: true, difficultyLevel: true } },
            chapter: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true } }
          } 
        },
      },
    });

    const conceptStats = {};
    for (const answer of answers) {
      const concept = answer.question?.concept;
      if (!concept) continue;

      // Filter by chapter if specified
      if (chapterId && answer.question?.chapter?.id !== chapterId) continue;

      const conceptKey = concept.id;
      if (!conceptStats[conceptKey]) {
        conceptStats[conceptKey] = { 
          id: concept.id,
          name: concept.name,
          difficultyLevel: concept.difficultyLevel,
          chapterId: answer.question?.chapter?.id,
          chapterName: answer.question?.chapter?.name,
          subjectId: answer.question?.subject?.id,
          subjectName: answer.question?.subject?.name,
          correct: 0, 
          total: 0 
        };
      }
      conceptStats[conceptKey].total++;
      if (answer.isCorrect) conceptStats[conceptKey].correct++;
    }

    return Object.values(conceptStats).map((stats) => ({
      conceptId: stats.id,
      concept: stats.name,
      name: stats.name,
      difficultyLevel: stats.difficultyLevel,
      chapterId: stats.chapterId,
      chapterName: stats.chapterName,
      subjectId: stats.subjectId,
      subjectName: stats.subjectName,
      mastery: calculatePercentage(stats.correct, stats.total),
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
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        studentId: true,
        rollNumber: true,
        profileCompleted: true,
        currentSemester: true,
        department: { select: { name: true, code: true } },
        section: { select: { name: true } },
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
    
    // Initialize all students in the map first (with default values)
    for (const student of students) {
      studentPerformanceMap[student.id] = {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        phoneNumber: student.phoneNumber,
        studentId: student.studentId,
        rollNumber: student.rollNumber,
        currentSemester: student.currentSemester,
        department: student.department,
        section: student.section,
        scores: [],
        examsAttempted: 0,
        totalCorrect: 0,
        totalWrong: 0,
        passed: 0,
        failed: 0,
        examHistory: [],
      };
    }
    
    // Then add performance data from exam attempts
    for (const attempt of allAttempts) {
      const attemptStudentId = attempt.student?.id;
      if (!attemptStudentId) continue;

      // Only update if student is in our map (exists in class)
      if (studentPerformanceMap[attemptStudentId]) {
        studentPerformanceMap[attemptStudentId].scores.push(attempt.percentage || 0);
        studentPerformanceMap[attemptStudentId].examsAttempted++;
        studentPerformanceMap[attemptStudentId].totalCorrect += attempt.correctAnswers || 0;
        studentPerformanceMap[attemptStudentId].totalWrong += attempt.wrongAnswers || 0;
        if (attempt.passed) {
          studentPerformanceMap[attemptStudentId].passed++;
        } else {
          studentPerformanceMap[attemptStudentId].failed++;
        }
        // Add to exam history with time attended
        const timeInMinutes = attempt.timeTaken ? Math.round(attempt.timeTaken / 60) : 0;
        studentPerformanceMap[attemptStudentId].examHistory.push({
          examTitle: attempt.exam?.title,
          score: attempt.percentage || 0,
          date: attempt.submittedAt || attempt.createdAt,
          timeAttended: timeInMinutes,
        });
      }
    }

    const studentPerformance = Object.values(studentPerformanceMap).map((s) => {
      const avg = s.scores.length > 0 ? s.scores.reduce((a, b) => a + b, 0) / s.scores.length : 0;
      const scores = [...s.scores].sort((a, b) => b - a);
      const trend = scores.length >= 2 ? scores[0] - scores[scores.length - 1] : 0;

      // Determine weak area based on performance
      let weakArea = 'Good';
      if (s.examsAttempted === 0) {
        weakArea = 'No Attempts';
      } else if (avg < 50) {
        weakArea = 'Needs Improvement';
      } else if (avg < 70) {
        weakArea = 'Average';
      }

      // Sort exam history by date, most recent first
      const sortedExamHistory = s.examHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        phoneNumber: s.phoneNumber,
        studentId: s.studentId,
        rollNumber: s.rollNumber,
        currentSemester: s.currentSemester,
        department: s.department,
        section: s.section,
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
        weakArea,
        examHistory: sortedExamHistory,
      };
    });

    studentPerformance.sort((a, b) => {
      // Sort by average score (but prioritize students with attempts)
      if (a.examsAttempted === 0 && b.examsAttempted === 0) return 0;
      if (a.examsAttempted === 0) return 1;
      if (b.examsAttempted === 0) return -1;
      return b.averageScore - a.averageScore;
    });

    // At-risk students are those with attempts AND scoring below 60
    const atRiskStudents = studentPerformance.filter((s) => s.examsAttempted > 0 && s.averageScore < 60);

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
   * Get personalized feedback for a student
   */
  async getStudentFeedback(studentId, examId = null) {
    const where = {
      studentId,
      status: { in: ['submitted', 'auto_submitted', 'graded'] },
    };

    if (examId) {
      where.examId = examId;
    }

    const attempts = await prisma.examAttempt.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            passingPercentage: true,
          },
        },
      },
    });

    if (attempts.length === 0) {
      return {
        overallFeedback: 'No exam attempts found yet. Complete an exam to receive personalized insights.',
        strengths: [],
        weaknesses: [],
        recommendations: [
          {
            type: 'recommendation',
            priority: 'medium',
            message: 'Start with one practice exam to build a baseline performance profile.',
            actionable: true,
            metadata: { estimatedTime: 45 },
          },
        ],
        nextSteps: [
          'Attempt an exam in your current course.',
          'Review chapter-level performance after submission.',
          'Create a goal based on your first result.',
        ],
        estimatedImprovementTime: 14,
        confidenceScore: 0.3,
      };
    }

    const avgPercentage = attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / attempts.length;
    const latestAttempt = attempts[0];
    const passCount = attempts.filter((a) => a.passed).length;
    const passRate = calculatePercentage(passCount, attempts.length);

    const attemptIds = attempts.map((a) => a.id);
    const answers = await prisma.studentAnswer.findMany({
      where: { attemptId: { in: attemptIds } },
      include: {
        question: {
          include: {
            chapter: { select: { id: true, name: true } },
            concept: { select: { id: true, name: true } },
          },
        },
      },
    });

    // ----- Chapter-level analysis -----
    const chapterStats = {};
    for (const answer of answers) {
      const chapterName = answer.question?.chapter?.name;
      if (!chapterName) continue;
      if (!chapterStats[chapterName]) chapterStats[chapterName] = { total: 0, correct: 0 };
      chapterStats[chapterName].total += 1;
      if (answer.isCorrect) chapterStats[chapterName].correct += 1;
    }
    const chapterAccuracy = Object.entries(chapterStats).map(([chapter, stats]) => ({
      chapter,
      accuracy: calculatePercentage(stats.correct, stats.total),
      total: stats.total,
    }));
    chapterAccuracy.sort((a, b) => b.accuracy - a.accuracy);

    // ----- Question-type analysis -----
    const typeStats = {};
    for (const answer of answers) {
      const qType = answer.question?.questionType;
      if (!qType) continue;
      if (!typeStats[qType]) typeStats[qType] = { total: 0, correct: 0 };
      typeStats[qType].total += 1;
      if (answer.isCorrect) typeStats[qType].correct += 1;
    }
    const typeAccuracy = Object.entries(typeStats).map(([type, stats]) => ({
      type,
      accuracy: calculatePercentage(stats.correct, stats.total),
      total: stats.total,
    }));

    // ----- Difficulty analysis -----
    const diffStats = {};
    for (const answer of answers) {
      const diff = answer.question?.difficulty || 'medium';
      if (!diffStats[diff]) diffStats[diff] = { total: 0, correct: 0 };
      diffStats[diff].total += 1;
      if (answer.isCorrect) diffStats[diff].correct += 1;
    }

    // ----- Concept-level analysis -----
    const conceptStats = {};
    for (const answer of answers) {
      const conceptName = answer.question?.concept?.name;
      if (!conceptName) continue;
      if (!conceptStats[conceptName]) conceptStats[conceptName] = { total: 0, correct: 0 };
      conceptStats[conceptName].total += 1;
      if (answer.isCorrect) conceptStats[conceptName].correct += 1;
    }
    const weakConcepts = Object.entries(conceptStats)
      .map(([concept, stats]) => ({
        concept,
        accuracy: calculatePercentage(stats.correct, stats.total),
        total: stats.total,
      }))
      .filter((c) => c.accuracy < 60 && c.total >= 2)
      .sort((a, b) => a.accuracy - b.accuracy);

    // ----- Trend analysis (if multiple attempts) -----
    let trendDirection = 'stable';
    if (attempts.length >= 2) {
      const sorted = [...attempts].sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
      const recentHalf = sorted.slice(Math.floor(sorted.length / 2));
      const olderHalf = sorted.slice(0, Math.floor(sorted.length / 2));
      const recentAvg = recentHalf.reduce((s, a) => s + (a.percentage || 0), 0) / recentHalf.length;
      const olderAvg = olderHalf.reduce((s, a) => s + (a.percentage || 0), 0) / olderHalf.length;
      if (recentAvg - olderAvg > 5) trendDirection = 'improving';
      else if (olderAvg - recentAvg > 5) trendDirection = 'declining';
    }

    // ----- Build feedback -----
    const strengths = [];
    const weaknesses = [];
    const recommendations = [];
    const nextSteps = [];

    // Overall performance strength/weakness
    if (avgPercentage >= 75) {
      strengths.push({
        type: 'performance',
        priority: 'low',
        message: `Excellent overall performance with an average of ${Math.round(avgPercentage)}% and ${passRate}% pass rate across ${attempts.length} exam(s).`,
        actionable: false,
      });
    } else if (avgPercentage >= 60) {
      strengths.push({
        type: 'performance',
        priority: 'low',
        message: `Steady average of ${Math.round(avgPercentage)}% across ${attempts.length} exam(s). You're in a good position to push into the high-performance band.`,
        actionable: true,
      });
    } else {
      weaknesses.push({
        type: 'performance',
        priority: 'high',
        message: `Your average score is ${Math.round(avgPercentage)}% across ${attempts.length} exam(s). A focused revision plan is needed to strengthen your foundation.`,
        actionable: true,
      });
    }

    // Strong chapters
    for (const ch of chapterAccuracy.slice(0, 3)) {
      if (ch.accuracy >= 75 && ch.total >= 2) {
        strengths.push({
          type: 'chapter',
          priority: 'low',
          message: `Strong mastery in ${ch.chapter} with ${ch.accuracy}% accuracy (${ch.total} questions).`,
          actionable: false,
          metadata: { chapter: ch.chapter },
        });
      }
    }

    // Weak chapters
    const weakChapters = [...chapterAccuracy].sort((a, b) => a.accuracy - b.accuracy);
    for (const ch of weakChapters.slice(0, 3)) {
      if (ch.accuracy < 60) {
        weaknesses.push({
          type: 'chapter',
          priority: ch.accuracy < 40 ? 'high' : 'medium',
          message: `Low accuracy in ${ch.chapter} (${ch.accuracy}% over ${ch.total} questions). This chapter needs focused revision.`,
          actionable: true,
          metadata: { chapter: ch.chapter },
        });
        recommendations.push({
          type: 'practice',
          priority: ch.accuracy < 40 ? 'high' : 'medium',
          message: `Practice ${ch.chapter} with targeted questions. ${ch.accuracy < 40 ? 'Start with basic concepts and build up gradually.' : 'Focus on the specific topics you find challenging.'}`,
          actionable: true,
          metadata: { chapter: ch.chapter, estimatedTime: ch.accuracy < 40 ? 90 : 60 },
        });
      }
    }

    // Weak concepts
    for (const c of weakConcepts.slice(0, 3)) {
      weaknesses.push({
        type: 'concept',
        priority: c.accuracy < 40 ? 'high' : 'medium',
        message: `Struggling with "${c.concept}" (${c.accuracy}% accuracy). Review this concept thoroughly.`,
        actionable: true,
        metadata: { concept: c.concept },
      });
    }

    // Question type insights
    for (const t of typeAccuracy) {
      const typeLabel = t.type === 'mcq' ? 'Multiple Choice' : t.type === 'true_false' ? 'True/False'
        : t.type === 'short_answer' ? 'Short Answer' : t.type === 'numerical' ? 'Numerical' : t.type;
      if (t.accuracy >= 80 && t.total >= 3) {
        strengths.push({
          type: 'question_type',
          priority: 'low',
          message: `You perform well on ${typeLabel} questions (${t.accuracy}% accuracy).`,
          actionable: false,
        });
      } else if (t.accuracy < 50 && t.total >= 3) {
        weaknesses.push({
          type: 'question_type',
          priority: 'medium',
          message: `${typeLabel} questions are challenging for you (${t.accuracy}% accuracy). Practice this format specifically.`,
          actionable: true,
        });
      }
    }

    // Difficulty insights
    const easyAcc = diffStats.easy ? calculatePercentage(diffStats.easy.correct, diffStats.easy.total) : null;
    const hardAcc = diffStats.hard ? calculatePercentage(diffStats.hard.correct, diffStats.hard.total) : null;
    if (easyAcc !== null && easyAcc < 70) {
      weaknesses.push({
        type: 'difficulty',
        priority: 'high',
        message: `You scored only ${easyAcc}% on easy questions. Revisit fundamental concepts before tackling harder material.`,
        actionable: true,
      });
    }
    if (hardAcc !== null && hardAcc >= 70) {
      strengths.push({
        type: 'difficulty',
        priority: 'low',
        message: `Strong performance on hard questions (${hardAcc}% accuracy). You handle challenging material well.`,
        actionable: false,
      });
    }

    // Trend feedback
    if (trendDirection === 'improving') {
      strengths.push({
        type: 'trend',
        priority: 'low',
        message: 'Your scores are trending upward. Your study efforts are paying off — keep this momentum!',
        actionable: false,
      });
    } else if (trendDirection === 'declining') {
      weaknesses.push({
        type: 'trend',
        priority: 'high',
        message: 'Your recent scores show a declining trend. Consider revisiting your study approach and identifying what changed.',
        actionable: true,
      });
      recommendations.push({
        type: 'study_habits',
        priority: 'high',
        message: 'Review what study methods worked for you previously and return to those approaches.',
        actionable: true,
        metadata: { estimatedTime: 30 },
      });
    }

    // Latest exam review
    if (latestAttempt?.exam?.title) {
      recommendations.push({
        type: 'exam-review',
        priority: 'medium',
        message: `Review your mistakes from "${latestAttempt.exam.title}" to identify recurring error patterns.`,
        actionable: true,
        metadata: { estimatedTime: 30 },
      });
    }

    // Ensure at least one recommendation
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'consistency',
        priority: 'low',
        message: 'Continue regular practice to maintain your momentum and accuracy.',
        actionable: true,
        metadata: { estimatedTime: 30 },
      });
    }

    // Generate specific, data-driven next steps
    if (weakChapters[0] && weakChapters[0].accuracy < 60) {
      nextSteps.push(`Focus on "${weakChapters[0].chapter}" — your weakest area at ${weakChapters[0].accuracy}% accuracy.`);
    }
    if (weakConcepts[0]) {
      nextSteps.push(`Review the concept "${weakConcepts[0].concept}" with practice exercises.`);
    }
    if (trendDirection === 'declining') {
      nextSteps.push('Revisit your study routine and schedule consistent review sessions.');
    }
    nextSteps.push('Re-attempt a quiz and compare your score to track improvement.');
    if (nextSteps.length < 3) {
      nextSteps.push('Set a target score for your next exam and work toward it.');
    }

    const overallFeedback = avgPercentage >= 75
      ? `Great job! You are performing well with an average of ${Math.round(avgPercentage)}% and a ${passRate}% pass rate. ${trendDirection === 'improving' ? 'Your upward trend shows excellent progress!' : 'Stay consistent to maintain this level.'}`
      : avgPercentage >= 60
        ? `You are on track with an average of ${Math.round(avgPercentage)}%. Focus on your weak chapters${weakConcepts.length > 0 ? ` and concepts like "${weakConcepts[0].concept}"` : ''} to push into the high-performance band.`
        : `Your current average is ${Math.round(avgPercentage)}%. ${trendDirection === 'declining' ? 'Your scores are declining — let\'s reverse that trend.' : 'A focused improvement plan targeting your weak areas can significantly raise your scores.'}`;

    return {
      overallFeedback,
      strengths: strengths.slice(0, 6),
      weaknesses: weaknesses.slice(0, 6),
      recommendations: recommendations.slice(0, 5),
      nextSteps: nextSteps.slice(0, 4),
      estimatedImprovementTime: avgPercentage < 60 ? 21 : 14,
      confidenceScore: Math.min(0.95, Math.max(0.4, attempts.length / 10 + 0.1)),
      // Per-exam feedback for ExamResults page
      chapterBreakdown: chapterAccuracy.slice(0, 8),
      typeBreakdown: typeAccuracy,
      difficultyBreakdown: Object.entries(diffStats).map(([level, stats]) => ({
        level,
        accuracy: calculatePercentage(stats.correct, stats.total),
        total: stats.total,
      })),
      trendDirection,
    };
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

    const [activeCoursesCount, activeSubjectsCount] = await Promise.all([
      prisma.course.count({ where: { isActive: true } }),
      prisma.subject.count(),
    ]);
    const activeCourses = activeCoursesCount || activeSubjectsCount;

    const totalExams = await prisma.exam.count();
    const examsTaken = await prisma.examAttempt.count();

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

    const usersWithDepartment = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        role: true,
        department: { select: { name: true, code: true } },
      },
    });

    const examsWithDepartment = await prisma.exam.findMany({
      select: {
        id: true,
        subject: {
          select: {
            department: true,
          },
        },
      },
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const recentAttempts = await prisma.examAttempt.findMany({
      where: {
        startedAt: { gte: sevenDaysAgo },
      },
      select: {
        examId: true,
        startedAt: true,
        submittedAt: true,
        status: true,
      },
    });

    const allAttempts = await prisma.examAttempt.findMany({
      select: {
        examId: true,
        status: true,
        startedAt: true,
        submittedAt: true,
      },
    });

    const allExams = await prisma.exam.findMany({
      select: {
        id: true,
        title: true,
      },
    });

    const recentActivity = recentUsers.map((u) => ({
      action: 'User registered',
      user: `${u.firstName} ${u.lastName}`,
      time: u.createdAt,
      type: u.role,
    }));

    const departmentStatsMap = new Map();
    usersWithDepartment.forEach((u) => {
      const deptName = u.department?.name || 'Other';
      const deptCode = u.department?.code || '';
      const key = deptCode || deptName;
      if (!departmentStatsMap.has(key)) {
        departmentStatsMap.set(key, {
          dept: deptCode ? `${deptName} (${deptCode})` : deptName,
          students: 0,
          educators: 0,
          exams: 0,
        });
      }
      const current = departmentStatsMap.get(key);
      if (u.role === 'student') current.students += 1;
      if (u.role === 'educator') current.educators += 1;
    });

    examsWithDepartment.forEach((e) => {
      const deptName = e.subject?.department || 'Other';
      const deptCode = '';
      const key = deptCode || deptName;
      if (!departmentStatsMap.has(key)) {
        departmentStatsMap.set(key, {
          dept: deptCode ? `${deptName} (${deptCode})` : deptName,
          students: 0,
          educators: 0,
          exams: 0,
        });
      }
      departmentStatsMap.get(key).exams += 1;
    });

    const departmentStats = Array.from(departmentStatsMap.values()).sort((a, b) => b.students - a.students);

    const departmentUsage = departmentStats.map((d) => {
      const users = d.students + d.educators;
      return {
        name: d.dept,
        users,
        value: totalUsers > 0 ? Math.round((users / totalUsers) * 100) : 0,
      };
    });

    const dateKey = (date) => date.toISOString().slice(0, 10);
    const dateLabel = (date) => `${date.getMonth() + 1}/${date.getDate()}`;

    const newUsersByDate = new Map();
    const recentCreatedUsers = await prisma.user.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, isActive: true },
      select: { createdAt: true },
    });
    recentCreatedUsers.forEach((u) => {
      const key = dateKey(u.createdAt);
      newUsersByDate.set(key, (newUsersByDate.get(key) || 0) + 1);
    });

    const startedByDate = new Map();
    const completedByDate = new Map();
    recentAttempts.forEach((a) => {
      const startedKey = dateKey(a.startedAt);
      startedByDate.set(startedKey, (startedByDate.get(startedKey) || 0) + 1);

      if (a.submittedAt || ['submitted', 'auto_submitted', 'graded'].includes(a.status)) {
        const completedKey = dateKey(a.submittedAt || a.startedAt);
        completedByDate.set(completedKey, (completedByDate.get(completedKey) || 0) + 1);
      }
    });

    const userActivity = [];
    const examActivity = [];
    let runningActiveUsers = Math.max(0, totalUsers - recentCreatedUsers.length);
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);
      const key = dateKey(date);
      const newUsers = newUsersByDate.get(key) || 0;
      runningActiveUsers += newUsers;

      userActivity.push({
        date: dateLabel(date),
        activeUsers: runningActiveUsers,
        newUsers,
      });

      examActivity.push({
        date: dateLabel(date),
        started: startedByDate.get(key) || 0,
        completed: completedByDate.get(key) || 0,
        avgScore: 0,
      });
    }

    const attemptsByExam = new Map();
    allAttempts.forEach((a) => {
      if (!attemptsByExam.has(a.examId)) {
        attemptsByExam.set(a.examId, { total: 0, completed: 0, responseSeconds: 0, responseCount: 0 });
      }
      const agg = attemptsByExam.get(a.examId);
      agg.total += 1;
      if (a.submittedAt || ['submitted', 'auto_submitted', 'graded'].includes(a.status)) {
        agg.completed += 1;
      }
      if (a.submittedAt && a.startedAt) {
        const diffSeconds = Math.max(0, Math.floor((new Date(a.submittedAt) - new Date(a.startedAt)) / 1000));
        agg.responseSeconds += diffSeconds;
        agg.responseCount += 1;
      }
    });

    const topExams = allExams
      .map((e) => {
        const agg = attemptsByExam.get(e.id) || { total: 0, completed: 0, responseSeconds: 0, responseCount: 0 };
        return {
          exam: e.title,
          attempts: agg.total,
          avgScore: 0,
          completion: agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : 0,
        };
      })
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 5);

    const overallResponse = allAttempts.reduce(
      (acc, a) => {
        if (a.submittedAt && a.startedAt) {
          acc.totalSeconds += Math.max(0, Math.floor((new Date(a.submittedAt) - new Date(a.startedAt)) / 1000));
          acc.count += 1;
        }
        return acc;
      },
      { totalSeconds: 0, count: 0 }
    );

    const avgResponseTime = overallResponse.count > 0
      ? `${Math.max(1, Math.round(overallResponse.totalSeconds / overallResponse.count))}s`
      : '-';

    return {
      totalUsers,
      totalStudents,
      totalEducators,
      totalAdmins,
      totalExams,
      examsTaken,
      activeCourses,
      userGrowth,
      departmentStats,
      recentActivity,
      userActivity,
      examActivity,
      departmentUsage,
      topExams,
      avgResponseTime,
      storageUsed: '-',
    };
  }
}

module.exports = new AnalyticsService();