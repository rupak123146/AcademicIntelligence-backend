/**
 * 🎓 Academic Intelligence Platform - MongoDB Models
 * Complete MongoDB schemas for College Academic Management System
 * 
 * Hierarchy: Institution → Departments → Sections → Students/Educators
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ============================================
// USER MODEL - Enhanced for all roles
// ============================================
const userSchema = new mongoose.Schema({
  // === Basic Info (All Roles) ===
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true,
    trim: true 
  },
  passwordHash: { type: String, required: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  role: { 
    type: String, 
    enum: ['student', 'educator', 'admin'], 
    required: true 
  },
  avatarUrl: { type: String },
  phoneNumber: { type: String },
  isActive: { type: Boolean, default: true },
  emailVerified: { type: Boolean, default: false },
  lastLoginAt: { type: Date },
  profileCompleted: { type: Boolean, default: false },
  
  // === Institution & Department Mapping ===
  institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' }, // For students
  
  // === Student-Specific Fields ===
  studentId: { type: String }, // USN: e.g., "4JC21CS001"
  rollNumber: { type: String }, // Class roll number
  admissionYear: { type: Number }, // Year of admission
  currentSemester: { type: Number }, // Current semester (1-8)
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ['male', 'female', 'other'] },
  bloodGroup: { type: String },
  // Academic Profile Fields (new)
  departmentCode: { type: String }, // CSE, ECE, ME, CE, EE, AE, AU, BT
  yearOfStudy: { type: String }, // I, II, III, IV (Roman numerals)
  class: { type: String }, // A, B, C
  currentCGPA: { type: Number }, // Current cumulative GPA
  marks10th: { type: Number }, // 10th standard percentage
  marks12th: { type: Number }, // 12th standard percentage
  // Guardian Information
  guardianName: { type: String },
  guardianPhone: { type: String },
  guardianEmail: { type: String },
  guardianRelation: { type: String }, // Father, Mother, Guardian
  // Address
  address: { type: String },
  residentialAddress: { type: String }, // Full residential address
  city: { type: String },
  state: { type: String },
  pincode: { type: String },
  
  // === Educator-Specific Fields ===
  employeeId: { type: String }, // e.g., "CSE001"
  designation: { 
    type: String, 
    enum: ['professor', 'associate_professor', 'assistant_professor', 'lecturer', 'lab_instructor', 'hod'],
  },
  qualification: { type: String }, // "Ph.D., M.Tech"
  specialization: { type: String }, // "Data Structures, Machine Learning"
  experience: { type: Number }, // Years of experience
  joiningDate: { type: Date },
  // Educators can handle multiple sections
  assignedSections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Section' }],
  // Subjects they teach
  subjectsTaught: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
  
  // === Admin-Specific Fields ===
  adminDesignation: { type: String }, // "Principal", "Dean", "Registrar"
  adminPermissions: [{ type: String }], // ["manage_users", "manage_exams", "manage_departments"]
  
}, {
  timestamps: true,
  collection: 'users'
});

userSchema.index({ role: 1 });
userSchema.index({ institutionId: 1 });
userSchema.index({ departmentId: 1 });
userSchema.index({ sectionId: 1 });
userSchema.index({ studentId: 1 });
userSchema.index({ employeeId: 1 });

userSchema.methods.comparePassword = async function(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.pre('save', async function(next) {
  if (this.isModified('passwordHash') && !this.passwordHash.startsWith('$2')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  }
  next();
});

// ============================================
// INSTITUTION MODEL (College)
// ============================================
const institutionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  type: { type: String, enum: ['university', 'college', 'institute'], default: 'college' },
  address: { type: String },
  city: { type: String },
  state: { type: String },
  pincode: { type: String },
  phone: { type: String },
  email: { type: String },
  website: { type: String },
  logoUrl: { type: String },
  principalName: { type: String },
  establishedYear: { type: Number },
  affiliatedTo: { type: String }, // Affiliated university
  isActive: { type: Boolean, default: true },
  settings: {
    defaultLanguage: { type: String, default: 'en' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    academicYearStart: { type: Number, default: 6 }, // June
    gradingSystem: { type: String, enum: ['percentage', 'cgpa', 'grade'], default: 'percentage' },
  },
}, {
  timestamps: true,
  collection: 'institutions'
});

// ============================================
// DEPARTMENT MODEL
// ============================================
const departmentSchema = new mongoose.Schema({
  institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
  name: { type: String, required: true }, // "Computer Science and Engineering"
  code: { type: String, required: true }, // "CSE"
  shortName: { type: String }, // "CS"
  headOfDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  description: { type: String },
  establishedYear: { type: Number },
  totalSeats: { type: Number }, // Intake capacity
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'departments'
});

departmentSchema.index({ institutionId: 1, code: 1 }, { unique: true });

// ============================================
// SECTION MODEL (Class/Batch)
// e.g., "3rd Year A", "2nd Year B", "1st Year C"
// ============================================
const sectionSchema = new mongoose.Schema({
  institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  name: { type: String, required: true }, // "A", "B", "C"
  year: { type: Number, required: true }, // 1, 2, 3, 4 (Academic year)
  semester: { type: Number }, // 1-8
  academicYear: { type: String }, // "2025-2026"
  batchYear: { type: Number }, // Admission year batch: 2021, 2022, etc.
  classTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Class advisor/mentor
  maxStrength: { type: Number, default: 60 },
  currentStrength: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'sections'
});

sectionSchema.index({ departmentId: 1, year: 1, name: 1 });
sectionSchema.index({ institutionId: 1 });

// Virtual for display name like "3rd Year CSE - A"
sectionSchema.virtual('displayName').get(function() {
  const yearSuffix = { 1: 'st', 2: 'nd', 3: 'rd', 4: 'th' };
  return `${this.year}${yearSuffix[this.year] || 'th'} Year - Section ${this.name}`;
});

// ============================================
// SUBJECT MODEL
// ============================================
const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  description: { type: String },
  department: { type: String },
  institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
}, {
  timestamps: true,
  collection: 'subjects'
});

// ============================================
// CHAPTER MODEL
// ============================================
const chapterSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  name: { type: String, required: true },
  chapterNumber: { type: Number, required: true },
  description: { type: String },
}, {
  timestamps: true,
  collection: 'chapters'
});

chapterSchema.index({ subjectId: 1, chapterNumber: 1 });

// ============================================
// CONCEPT MODEL
// ============================================
const conceptSchema = new mongoose.Schema({
  chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
  name: { type: String, required: true },
  description: { type: String },
  difficultyLevel: { type: String, enum: ['easy', 'medium', 'hard'] },
}, {
  timestamps: true,
  collection: 'concepts'
});

conceptSchema.index({ chapterId: 1 });

// ============================================
// COURSE MODEL
// ============================================
const courseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  description: { type: String },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  academicYear: { type: String },
  semester: { type: String },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'courses'
});

courseSchema.index({ instructorId: 1 });
courseSchema.index({ code: 1 });

// ============================================
// STUDENT ENROLLMENT MODEL
// ============================================
const studentEnrollmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  status: { 
    type: String, 
    enum: ['enrolled', 'completed', 'dropped', 'pending'], 
    default: 'enrolled' 
  },
  enrolledAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'student_enrollments'
});

studentEnrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

// ============================================
// QUESTION MODEL
// ============================================
const questionSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter' },
  conceptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Concept' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  questionText: { type: String, required: true },
  questionType: { 
    type: String, 
    enum: ['mcq', 'multiple', 'true_false', 'short_answer', 'numerical'],
    required: true 
  },
  options: [{ 
    text: String, 
    isCorrect: Boolean 
  }],
  correctAnswer: { type: mongoose.Schema.Types.Mixed },
  explanation: { type: String },
  difficulty: { 
    type: String, 
    enum: ['easy', 'medium', 'hard'], 
    default: 'medium' 
  },
  marks: { type: Number, default: 1 },
  negativeMarks: { type: Number, default: 0 },
  tags: [{ type: String }],
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'questions'
});

questionSchema.index({ subjectId: 1 });
questionSchema.index({ chapterId: 1 });
questionSchema.index({ difficulty: 1 });
questionSchema.index({ tags: 1 });

// ============================================
// EXAM MODEL - With Section/Department Assignment
// ============================================
const examSchema = new mongoose.Schema({
  // Basic Info
  title: { type: String, required: true },
  description: { type: String },
  instructions: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
  
  // Subject/Course linkage
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  
  // === EXAM ASSIGNMENT - Who can take this exam ===
  // Assign to specific sections
  assignedSections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Section' }],
  // Or assign to entire departments
  assignedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  // Or assign to specific students (for special cases)
  assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Assignment mode: 'section', 'department', 'individual', 'all'
  assignmentMode: { 
    type: String, 
    enum: ['section', 'department', 'individual', 'all'],
    default: 'section'
  },
  
  // Exam Configuration
  examType: { 
    type: String, 
    enum: ['quiz', 'unit_test', 'internal', 'midterm', 'final', 'practice', 'assignment'],
    default: 'quiz'
  },
  durationMinutes: { type: Number, required: true },
  totalMarks: { type: Number, required: true },
  passingMarks: { type: Number },
  passingPercentage: { type: Number, default: 40 },
  negativeMarking: { type: Boolean, default: false },
  negativeMarkValue: { type: Number, default: 0 },
  shuffleQuestions: { type: Boolean, default: true },
  shuffleOptions: { type: Boolean, default: true },
  showResult: { type: Boolean, default: true },
  showAnswers: { type: Boolean, default: false },
  allowReview: { type: Boolean, default: true },
  maxAttempts: { type: Number, default: 1 },
  
  // Scheduling
  status: { 
    type: String, 
    enum: ['draft', 'published', 'active', 'completed', 'archived'],
    default: 'draft'
  },
  startTime: { type: Date },
  endTime: { type: Date },
  
  // Questions
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  
  // Analytics
  totalAttempts: { type: Number, default: 0 },
  averageScore: { type: Number, default: 0 },
}, {
  timestamps: true,
  collection: 'exams'
});

examSchema.index({ createdBy: 1 });
examSchema.index({ status: 1 });
examSchema.index({ startTime: 1, endTime: 1 });
examSchema.index({ assignedSections: 1 });
examSchema.index({ assignedDepartments: 1 });
examSchema.index({ institutionId: 1 });

// ============================================
// EXAM ATTEMPT MODEL
// ============================================
const examAttemptSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attemptNumber: { type: Number, default: 1 },
  status: { 
    type: String, 
    enum: ['started', 'in_progress', 'submitted', 'auto_submitted', 'graded'],
    default: 'started'
  },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date },
  ipAddress: { type: String },
  browserInfo: { type: mongoose.Schema.Types.Mixed },
  totalScore: { type: Number, default: 0 },
  maxScore: { type: Number },
  percentage: { type: Number },
  correctAnswers: { type: Number, default: 0 },
  wrongAnswers: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  timeTaken: { type: Number }, // in seconds
  grade: { type: String },
  passed: { type: Boolean },
}, {
  timestamps: true,
  collection: 'exam_attempts'
});

examAttemptSchema.index({ examId: 1, studentId: 1 });
examAttemptSchema.index({ studentId: 1, status: 1 });

// ============================================
// STUDENT ANSWER MODEL
// ============================================
const studentAnswerSchema = new mongoose.Schema({
  attemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAttempt', required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  selectedAnswer: { type: mongoose.Schema.Types.Mixed },
  isCorrect: { type: Boolean },
  isAnswered: { type: Boolean, default: false },
  marksAwarded: { type: Number, default: 0 },
  timeSpent: { type: Number }, // in seconds
  answeredAt: { type: Date },
}, {
  timestamps: true,
  collection: 'student_answers'
});

studentAnswerSchema.index({ attemptId: 1 });
studentAnswerSchema.index({ questionId: 1 });

// ============================================
// USER SESSION MODEL
// ============================================
const userSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true },
  refreshToken: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  deviceInfo: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'user_sessions'
});

userSessionSchema.index({ userId: 1 });
userSessionSchema.index({ token: 1 });
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ============================================
// EXAM ACTIVITY LOG MODEL
// ============================================
const examActivityLogSchema = new mongoose.Schema({
  attemptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAttempt', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  eventType: {
    type: String,
    enum: ['exam_started', 'question_viewed', 'answer_submitted', 'answer_changed', 'tab_switched', 'exam_paused', 'exam_resumed', 'exam_submitted'],
    required: true,
  },
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
  previousAnswer: { type: mongoose.Schema.Types.Mixed },
  newAnswer: { type: mongoose.Schema.Types.Mixed },
  timeSpentOnQuestion: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'exam_activity_logs'
});

examActivityLogSchema.index({ attemptId: 1 });
examActivityLogSchema.index({ studentId: 1 });
examActivityLogSchema.index({ examId: 1 });
examActivityLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days TTL

// ============================================
// EXAM ASSIGNMENT MODEL (which courses can take which exams)
// ============================================
const examAssignmentSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedAt: { type: Date, default: Date.now },
  dueDate: { type: Date },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'exam_assignments'
});

examAssignmentSchema.index({ examId: 1, courseId: 1 }, { unique: true });
examAssignmentSchema.index({ courseId: 1 });

// ============================================
// TASK MODEL
// ============================================
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Educator
  taskType: { 
    type: String, 
    enum: ['assignment', 'homework', 'project', 'quiz', 'reading'],
    default: 'assignment'
  },
  dueDate: { type: Date, required: true },
  instructions: { type: String },
  attachments: [{ 
    fileName: String,
    fileUrl: String,
    uploadedAt: Date
  }],
  totalMarks: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'published', 'closed', 'archived'],
    default: 'draft'
  },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'tasks'
});

taskSchema.index({ courseId: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ dueDate: 1 });

// ============================================
// TASK ASSIGNMENT MODEL
// ============================================
const taskAssignmentSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedAt: { type: Date, default: Date.now },
  submissionStatus: {
    type: String,
    enum: ['pending', 'submitted', 'graded', 'late'],
    default: 'pending'
  },
  submissionDate: { type: Date },
  submissionUrl: { type: String },
  feedback: { type: String },
  marksAwarded: { type: Number },
  grade: { type: String },
}, {
  timestamps: true,
  collection: 'task_assignments'
});

taskAssignmentSchema.index({ taskId: 1, studentId: 1 }, { unique: true });
taskAssignmentSchema.index({ studentId: 1 });
taskAssignmentSchema.index({ submissionStatus: 1 });

// ============================================
// CREATE AND EXPORT MODELS
// ============================================
const User = mongoose.model('User', userSchema);
const Institution = mongoose.model('Institution', institutionSchema);
const Department = mongoose.model('Department', departmentSchema);
const Section = mongoose.model('Section', sectionSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Chapter = mongoose.model('Chapter', chapterSchema);
const Concept = mongoose.model('Concept', conceptSchema);
const Course = mongoose.model('Course', courseSchema);
const StudentEnrollment = mongoose.model('StudentEnrollment', studentEnrollmentSchema);
const Question = mongoose.model('Question', questionSchema);
const Exam = mongoose.model('Exam', examSchema);
const ExamAttempt = mongoose.model('ExamAttempt', examAttemptSchema);
const StudentAnswer = mongoose.model('StudentAnswer', studentAnswerSchema);
const UserSession = mongoose.model('UserSession', userSessionSchema);
const ExamActivityLog = mongoose.model('ExamActivityLog', examActivityLogSchema);
const ExamAssignment = mongoose.model('ExamAssignment', examAssignmentSchema);
const Task = mongoose.model('Task', taskSchema);
const TaskAssignment = mongoose.model('TaskAssignment', taskAssignmentSchema);

module.exports = {
  User,
  Institution,
  Department,
  Section,
  Subject,
  Chapter,
  Concept,
  Course,
  StudentEnrollment,
  Question,
  Exam,
  ExamAttempt,
  StudentAnswer,
  UserSession,
  ExamActivityLog,
  ExamAssignment,
  Task,
  TaskAssignment,
};
