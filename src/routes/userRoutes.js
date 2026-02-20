const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const buildUserProfile = (user) => {
  const baseProfile = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    phoneNumber: user.phoneNumber || '',
    avatarUrl: user.avatarUrl || '',
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    profileCompleted: user.profileCompleted,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    institution: user.institution ? {
      id: user.institution.id,
      name: user.institution.name,
      code: user.institution.code,
      city: user.institution.city,
      state: user.institution.state,
    } : null,
    department: user.department ? {
      id: user.department.id,
      name: user.department.name,
      code: user.department.code,
    } : null,
  };

  if (user.role === 'student') {
    return {
      ...baseProfile,
      studentId: user.studentId || '',
      rollNumber: user.rollNumber || '',
      admissionYear: user.admissionYear,
      currentSemester: user.currentSemester,
      section: user.section ? {
        id: user.section.id,
        name: user.section.name,
        year: user.section.year,
        semester: user.section.semester,
        academicYear: user.section.academicYear,
      } : null,
      departmentCode: user.departmentCode || '',
      yearOfStudy: user.yearOfStudy || '',
      class: user.class || '',
      currentCGPA: user.currentCGPA,
      marks10th: user.marks10th,
      marks12th: user.marks12th,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender || '',
      bloodGroup: user.bloodGroup || '',
      guardianName: user.guardianName || '',
      guardianPhone: user.guardianPhone || '',
      guardianEmail: user.guardianEmail || '',
      guardianRelation: user.guardianRelation || '',
      address: user.address || '',
      residentialAddress: user.residentialAddress || '',
      city: user.city || '',
      state: user.state || '',
      pincode: user.pincode || '',
    };
  }

  if (user.role === 'educator') {
    return {
      ...baseProfile,
      employeeId: user.employeeId || '',
      designation: user.designation || '',
      qualification: user.qualification || '',
      specialization: user.specialization || '',
      experience: user.experience || 0,
      joiningDate: user.joiningDate,
      assignedSections: user.educatorSections?.map((rel) => ({
        id: rel.section.id,
        name: rel.section.name,
        year: rel.section.year,
        semester: rel.section.semester,
        departmentName: rel.section.department?.name,
        departmentCode: rel.section.department?.code,
      })) || [],
      subjectsTaught: user.educatorSubjects?.map((rel) => ({
        id: rel.subject.id,
        name: rel.subject.name,
        code: rel.subject.code,
      })) || [],
    };
  }

  if (user.role === 'admin') {
    return {
      ...baseProfile,
      employeeId: user.employeeId || '',
      adminDesignation: user.adminDesignation || '',
      adminPermissions: user.adminPermissions || [],
    };
  }

  return baseProfile;
};

const profileInclude = {
  institution: { select: { id: true, name: true, code: true, city: true, state: true } },
  department: { select: { id: true, name: true, code: true } },
  section: { select: { id: true, name: true, year: true, semester: true, academicYear: true } },
  educatorSections: {
    include: {
      section: {
        include: { department: { select: { name: true, code: true } } },
      },
    },
  },
  educatorSubjects: {
    include: { subject: { select: { id: true, name: true, code: true } } },
  },
};

/**
 * @route GET /api/v1/users/profile
 * @desc Get current user profile with all role-specific fields
 * @access Private
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: profileInclude,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: buildUserProfile(user),
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/v1/users/profile
 * @desc Update user profile (for students - complete profile)
 * @access Private
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    const updateData = {};

    const allowedFields = [
      'firstName', 'lastName', 'phoneNumber', 'dateOfBirth', 'gender',
      'departmentCode', 'yearOfStudy', 'class', 'currentCGPA', 'marks10th', 'marks12th',
      'guardianName', 'guardianPhone', 'guardianEmail', 'guardianRelation',
      'address', 'residentialAddress', 'city', 'state', 'pincode',
      'qualification', 'specialization', 'experience',
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined && req.body[field] !== null) {
        updateData[field] = req.body[field];
      }
    });

    if (req.body.phoneNumber || req.body.departmentCode) {
      updateData.profileCompleted = true;
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: profileInclude,
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: buildUserProfile(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/users/students/department/:departmentId
 * @desc Get all students in a department with completed profiles
 * @access Private (Educator/Admin)
 */
router.get('/students/department/:departmentId', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });
    if (user.role !== 'educator' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only educators and admins can view student lists',
      });
    }

    const { departmentId } = req.params;
    const { studentClass } = req.query;

    const filter = {
      role: 'student',
      departmentId,
      profileCompleted: true,
    };

    if (studentClass) {
      filter.class = studentClass;
    }

    const students = await prisma.user.findMany({
      where: filter,
      orderBy: [{ class: 'asc' }, { rollNumber: 'asc' }],
    });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/users/students
 * @desc Get all students for current educator (their department)
 * @access Private (Educator)
 */
router.get('/students', authenticate, async (req, res) => {
  try {
    const educator = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true },
    });

    if (educator.role !== 'educator' && educator.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only educators can access this endpoint',
      });
    }

    const students = await prisma.user.findMany({
      where: {
        role: 'student',
        departmentId: educator.departmentId,
        profileCompleted: true,
      },
      include: {
        section: { select: { id: true, name: true, year: true } },
        department: { select: { id: true, name: true, code: true } },
      },
      orderBy: { rollNumber: 'asc' },
    });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/users/admin/users
 * @desc Get all users (admin endpoint)
 * @access Private (Admin)
 */
router.get('/admin/users', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can access this endpoint',
      });
    }

    const { role, status, page = 1, limit = 10 } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;

    const skip = (page - 1) * limit;

    const users = await prisma.user.findMany({
      where: filter,
      skip,
      take: parseInt(limit, 10),
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.user.count({ where: filter });

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
});

// ============================================
// SECTIONS & DEPARTMENTS FOR EXAM ASSIGNMENT
// ============================================

/**
 * @route GET /api/v1/users/departments
 * @desc Get all departments (for educator - their department, for admin - all)
 * @access Private (Educator/Admin)
 */
router.get('/departments', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true },
    });

    if (!['educator', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const filter = { isActive: true };
    if (user.role === 'educator' && user.departmentId) {
      filter.id = user.departmentId;
    }

    const departments = await prisma.department.findMany({
      where: filter,
      include: { headOfDepartment: { select: { firstName: true, lastName: true } } },
      orderBy: { code: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: departments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch departments',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/users/sections
 * @desc Get sections for exam assignment
 * @access Private (Educator/Admin)
 */
router.get('/sections', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true },
    });

    if (!['educator', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const { departmentId } = req.query;
    const filter = { isActive: true };

    if (user.role === 'educator' && user.departmentId) {
      filter.departmentId = user.departmentId;
    } else if (departmentId) {
      filter.departmentId = departmentId;
    }

    const sections = await prisma.section.findMany({
      where: filter,
      include: {
        department: { select: { name: true, code: true } },
        classTeacher: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ year: 'asc' }, { name: 'asc' }],
    });

    const formattedSections = sections.map((s) => ({
      _id: s.id,
      name: s.name,
      year: s.year,
      semester: s.semester,
      academicYear: s.academicYear,
      displayName: `${s.year}${['st', 'nd', 'rd', 'th'][s.year - 1] || 'th'} Year - Section ${s.name}`,
      departmentName: s.department?.name,
      departmentCode: s.department?.code,
      classTeacher: s.classTeacher ? `${s.classTeacher.firstName} ${s.classTeacher.lastName}` : null,
      currentStrength: s.currentStrength,
      maxStrength: s.maxStrength,
    }));

    res.status(200).json({
      success: true,
      data: formattedSections,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sections',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/users/sections/:sectionId/students
 * @desc Get all students in a specific section
 * @access Private (Educator/Admin)
 */
router.get('/sections/:sectionId/students', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true },
    });

    if (!['educator', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const { sectionId } = req.params;

    if (user.role === 'educator') {
      const section = await prisma.section.findUnique({
        where: { id: sectionId },
        select: { departmentId: true },
      });
      if (!section || section.departmentId !== user.departmentId) {
        return res.status(403).json({
          success: false,
          message: 'You can only view students in your department',
        });
      }
    }

    const students = await prisma.user.findMany({
      where: {
        role: 'student',
        sectionId,
        isActive: true,
      },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        studentId: true,
        rollNumber: true,
        currentSemester: true,
        profileCompleted: true,
      },
      orderBy: { rollNumber: 'asc' },
    });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/users/my-students
 * @desc Get all students in educator's department grouped by section
 * @access Private (Educator)
 */
router.get('/my-students', authenticate, async (req, res) => {
  try {
    const educator = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, departmentId: true },
    });

    if (educator.role !== 'educator') {
      return res.status(403).json({
        success: false,
        message: 'Only educators can access this endpoint',
      });
    }

    const sections = await prisma.section.findMany({
      where: { departmentId: educator.departmentId, isActive: true },
      orderBy: [{ year: 'asc' }, { name: 'asc' }],
    });

    const result = await Promise.all(sections.map(async (section) => {
      const students = await prisma.user.findMany({
        where: { role: 'student', sectionId: section.id, isActive: true },
        select: { firstName: true, lastName: true, email: true, studentId: true, rollNumber: true, currentSemester: true },
        orderBy: { rollNumber: 'asc' },
      });

      return {
        section: {
          _id: section.id,
          name: section.name,
          year: section.year,
          displayName: `${section.year}${['st', 'nd', 'rd', 'th'][section.year - 1] || 'th'} Year - Section ${section.name}`,
        },
        studentCount: students.length,
        students,
      };
    }));

    const totalStudents = result.reduce((sum, s) => sum + s.studentCount, 0);

    res.status(200).json({
      success: true,
      totalStudents,
      sectionCount: result.length,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: error.message,
    });
  }
});

module.exports = router;