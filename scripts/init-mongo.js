// 🎓 Academic Intelligence Platform - MongoDB Initialization Script
// This script initializes collections and creates indexes for exam attempts

// Switch to the application database
db = db.getSiblingDB('academic_intelligence');

// ============================================
// COLLECTIONS & INDEXES
// ============================================

// Exam Attempts Collection
db.createCollection('exam_attempts', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['examId', 'studentId', 'status', 'startedAt'],
            properties: {
                examId: {
                    bsonType: 'string',
                    description: 'UUID of the exam'
                },
                studentId: {
                    bsonType: 'string',
                    description: 'UUID of the student'
                },
                status: {
                    enum: ['in_progress', 'submitted', 'timed_out', 'graded'],
                    description: 'Current status of the attempt'
                },
                startedAt: {
                    bsonType: 'date',
                    description: 'When the exam was started'
                },
                submittedAt: {
                    bsonType: 'date',
                    description: 'When the exam was submitted'
                },
                score: {
                    bsonType: 'double',
                    description: 'Total score obtained'
                },
                percentage: {
                    bsonType: 'double',
                    description: 'Percentage score'
                },
                answers: {
                    bsonType: 'array',
                    description: 'Array of answers for each question'
                },
                timeSpent: {
                    bsonType: 'int',
                    description: 'Total time spent in seconds'
                },
                tabSwitches: {
                    bsonType: 'int',
                    description: 'Number of times tab was switched'
                }
            }
        }
    }
});

// Create indexes for exam_attempts
db.exam_attempts.createIndex({ examId: 1 });
db.exam_attempts.createIndex({ studentId: 1 });
db.exam_attempts.createIndex({ status: 1 });
db.exam_attempts.createIndex({ examId: 1, studentId: 1 });
db.exam_attempts.createIndex({ submittedAt: -1 });
db.exam_attempts.createIndex({ 'answers.questionId': 1 });

// Analytics Collection - Pre-computed analytics data
db.createCollection('analytics_cache');
db.analytics_cache.createIndex({ studentId: 1, type: 1 });
db.analytics_cache.createIndex({ examId: 1, type: 1 });
db.analytics_cache.createIndex({ classId: 1, type: 1 });
db.analytics_cache.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 86400 }); // TTL: 24 hours

// Learning Gaps Collection
db.createCollection('learning_gaps');
db.learning_gaps.createIndex({ studentId: 1 });
db.learning_gaps.createIndex({ conceptId: 1 });
db.learning_gaps.createIndex({ severity: -1 });
db.learning_gaps.createIndex({ detectedAt: -1 });

// Feedback Collection - AI-generated feedback
db.createCollection('feedback');
db.feedback.createIndex({ attemptId: 1 });
db.feedback.createIndex({ studentId: 1 });
db.feedback.createIndex({ generatedAt: -1 });

// Activity Log Collection
db.createCollection('activity_log', {
    capped: true,
    size: 100000000, // 100MB cap
    max: 500000      // Max 500k documents
});
db.activity_log.createIndex({ userId: 1, timestamp: -1 });
db.activity_log.createIndex({ action: 1 });
db.activity_log.createIndex({ timestamp: -1 });

// ============================================
// SAMPLE DATA
// ============================================

// Insert sample exam attempt
db.exam_attempts.insertOne({
    examId: '00000000-0000-0000-0000-000000000001',
    studentId: '00000000-0000-0000-0000-000000000002',
    status: 'graded',
    startedAt: new Date('2025-01-15T10:00:00Z'),
    submittedAt: new Date('2025-01-15T11:30:00Z'),
    score: 85,
    percentage: 85,
    totalMarks: 100,
    answers: [
        {
            questionId: 'q1',
            selectedAnswer: 'A',
            isCorrect: true,
            marksObtained: 10,
            timeSpent: 120
        },
        {
            questionId: 'q2',
            selectedAnswer: 'B',
            isCorrect: true,
            marksObtained: 10,
            timeSpent: 90
        }
    ],
    timeSpent: 5400,
    tabSwitches: 2,
    metadata: {
        browser: 'Chrome',
        platform: 'Windows',
        ipAddress: '192.168.1.1'
    }
});

print('MongoDB initialization completed successfully!');
print('Collections created: exam_attempts, analytics_cache, learning_gaps, feedback, activity_log');
