/**
 * 🎓 Academic Intelligence Platform - Auth Service (SQL/Prisma)
 * Authentication and user management using MySQL
 */

const { prisma } = require('../config/database');
const { setCache, getCache, deleteCache, CacheKeys } = require('../config/redis');
const { hashPassword, comparePassword, generateTokenPair, verifyRefreshToken } = require('../utils/auth');
const { ApiError, generateRandomString } = require('../utils/helpers');
const logger = require('../utils/logger');

class AuthService {
  /**
   * Register a new user
   */
  async register(userData) {
    const { 
      email, password, firstName, lastName, role, 
      institutionId, departmentId, 
      studentId, sectionId, 
      employeeId, designation, assignedSections 
    } = userData;

    // Check if email already exists
    const normalizedEmail = email.toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw ApiError.conflict('Email already registered');
    }

    // Skip institution validation - it's optional and may not be a valid ObjectId

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user with all provided fields
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        firstName,
        lastName,
        role: role || 'student',
        institutionId: institutionId || undefined,
        departmentId: departmentId || undefined,
        studentId: studentId || undefined,
        sectionId: sectionId || undefined,
        employeeId: employeeId || undefined,
        designation: designation || undefined,
        educatorSections: assignedSections?.length
          ? {
            create: assignedSections.map((sectionId) => ({ sectionId })),
          }
          : undefined,
      },
    });

    logger.info('User registered:', { userId: user.id, email: user.email, role: user.role });

    // Generate tokens so user is auto-logged in after registration
    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      institution_id: user.institutionId || undefined,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }

  /**
   * Login user
   */
  async login(email, password, metadata = {}) {
    // Get user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account has been deactivated');
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.passwordHash);
    if (!isValidPassword) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    // Generate tokens
    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      institution_id: user.institutionId,
    });

    // Store session
    await prisma.userSession.create({
      data: {
        userId: user.id,
        token: tokens.accessToken.substring(0, 100),
        refreshToken: tokens.refreshToken.substring(0, 100),
        ipAddress: metadata.ipAddress || null,
        userAgent: metadata.userAgent || null,
        deviceInfo: metadata.deviceInfo || {},
        expiresAt: new Date(tokens.refreshTokenExpiry),
      },
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Cache session
    await setCache(CacheKeys.userSession(user.id), {
      userId: user.id,
      role: user.role,
      institutionId: user.institutionId,
    }, 900);

    logger.info('User logged in:', { userId: user.id, email: user.email });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        institutionId: user.institutionId,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken) {
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      throw ApiError.unauthorized('Invalid refresh token');
    }

    const session = await prisma.userSession.findFirst({
      where: {
        userId: decoded.userId,
        refreshToken: refreshToken.substring(0, 100),
        isActive: true,
      },
    });

    if (!session) {
      throw ApiError.unauthorized('Session not found or expired');
    }

    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, isActive: true },
    });
    if (!user) {
      throw ApiError.unauthorized('User not found or inactive');
    }

    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      institution_id: user.institutionId,
    });

    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        token: tokens.accessToken.substring(0, 100),
        refreshToken: tokens.refreshToken.substring(0, 100),
        expiresAt: new Date(tokens.refreshTokenExpiry),
      },
    });

    await setCache(CacheKeys.userSession(user.id), {
      userId: user.id,
      role: user.role,
      institutionId: user.institutionId,
    }, 900);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  /**
   * Logout user
   */
  async logout(userId, token) {
    await prisma.userSession.updateMany({
      where: { userId, token: token.substring(0, 100) },
      data: { isActive: false },
    });
    await deleteCache(CacheKeys.userSession(userId));
    logger.info('User logged out:', { userId });
    return true;
  }

  /**
   * Get user profile with all role-specific fields
   */
  async getProfile(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        institution: { select: { id: true, name: true, code: true, city: true, state: true } },
        department: { select: { id: true, name: true, code: true } },
        section: { select: { id: true, name: true, year: true, semester: true, academicYear: true } },
        educatorSections: {
          include: {
            section: { select: { id: true, name: true, year: true, semester: true } },
          },
        },
        educatorSubjects: {
          include: { subject: { select: { id: true, name: true, code: true } } },
        },
      },
    });
    
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    // Build response based on role
    const baseProfile = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      phoneNumber: user.phoneNumber,
      avatarUrl: user.avatarUrl,
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

    // Add role-specific fields
    if (user.role === 'student') {
      return {
        ...baseProfile,
        // Academic info
        studentId: user.studentId,
        rollNumber: user.rollNumber,
        admissionYear: user.admissionYear,
        currentSemester: user.currentSemester,
        section: user.section ? {
          id: user.section.id,
          name: user.section.name,
          year: user.section.year,
          semester: user.section.semester,
          academicYear: user.section.academicYear,
        } : null,
        // Profile fields
        departmentCode: user.departmentCode,
        yearOfStudy: user.yearOfStudy,
        class: user.class,
        currentCGPA: user.currentCGPA,
        marks10th: user.marks10th,
        marks12th: user.marks12th,
        // Personal info
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        bloodGroup: user.bloodGroup,
        // Guardian info
        guardianName: user.guardianName,
        guardianPhone: user.guardianPhone,
        guardianEmail: user.guardianEmail,
        guardianRelation: user.guardianRelation,
        // Address
        address: user.address,
        residentialAddress: user.residentialAddress,
        city: user.city,
        state: user.state,
        pincode: user.pincode,
      };
    }

    if (user.role === 'educator') {
      return {
        ...baseProfile,
        // Professional info
        employeeId: user.employeeId,
        designation: user.designation,
        qualification: user.qualification,
        specialization: user.specialization,
        experience: user.experience,
        joiningDate: user.joiningDate,
        // Assigned sections
        assignedSections: user.educatorSections?.map((rel) => ({
          id: rel.section.id,
          name: rel.section.name,
          year: rel.section.year,
          semester: rel.section.semester,
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
        employeeId: user.employeeId,
        adminDesignation: user.adminDesignation,
        adminPermissions: user.adminPermissions || [],
      };
    }

    return baseProfile;
  }

  /**
   * Update user profile with role-specific fields
   */
  async updateProfile(userId, updateData) {
    // Get current user to check role
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!currentUser) {
      throw ApiError.notFound('User not found');
    }

    // Build update object with only provided fields
    const updateFields = {};
    
    // Common fields
    const commonFields = ['firstName', 'lastName', 'phoneNumber', 'avatarUrl'];
    commonFields.forEach(field => {
      if (updateData[field] !== undefined) updateFields[field] = updateData[field];
    });

    // Role-specific fields
    if (currentUser.role === 'student') {
      const studentFields = [
        'dateOfBirth', 'gender', 'bloodGroup',
        'departmentCode', 'yearOfStudy', 'class', 'currentCGPA', 'marks10th', 'marks12th',
        'guardianName', 'guardianPhone', 'guardianEmail', 'guardianRelation',
        'address', 'residentialAddress', 'city', 'state', 'pincode'
      ];
      studentFields.forEach(field => {
        if (updateData[field] !== undefined) updateFields[field] = updateData[field];
      });
    }

    if (currentUser.role === 'educator') {
      const educatorFields = [
        'qualification', 'specialization', 'experience'
      ];
      educatorFields.forEach(field => {
        if (updateData[field] !== undefined) updateFields[field] = updateData[field];
      });
    }
    
    // Mark profile as completed if key fields are filled
    const hasRequiredFields = currentUser.role === 'student' 
      ? (updateFields.phoneNumber || currentUser.phoneNumber)
      : (updateFields.qualification || currentUser.qualification);
    if (hasRequiredFields) {
      updateFields.profileCompleted = true;
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateFields,
    });

    logger.info('Profile updated:', { userId, fieldsUpdated: Object.keys(updateFields) });

    return this.getProfile(userId);
  }

  /**
   * Change password
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throw ApiError.badRequest('Current password is incorrect');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    await prisma.userSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    logger.info('Password changed:', { userId });
    return true;
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      return true; // Don't reveal if email exists
    }

    const resetToken = generateRandomString(32);
    await setCache(`reset:${resetToken}`, {
      userId: user.id,
      email: user.email,
    }, 3600);

    logger.info('Password reset requested:', { userId: user.id });
    return true;
  }

  /**
   * Reset password
   */
  async resetPassword(token, newPassword) {
    const resetData = await getCache(`reset:${token}`);
    if (!resetData) {
      throw ApiError.badRequest('Invalid or expired reset token');
    }

    const user = await prisma.user.findUnique({
      where: { id: resetData.userId },
    });
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    await deleteCache(`reset:${token}`);
    await prisma.userSession.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    });

    logger.info('Password reset completed:', { userId: user.id });
    return true;
  }

  /**
   * Get all users (Admin only)
   */
  async getAllUsers(filters = {}) {
    const query = {};
    
    if (filters.role) {
      query.role = filters.role;
    }
    if (filters.institutionId) {
      query.institutionId = filters.institutionId;
    }
    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    const users = await prisma.user.findMany({
      where: query,
      include: {
        institution: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        section: { select: { id: true, name: true, year: true, semester: true } },
        educatorSections: {
          include: { section: { select: { id: true, name: true, year: true, semester: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      institutionId: user.institution?.id,
      institutionName: user.institution?.name,
      departmentId: user.department?.id || user.departmentId,
      departmentName: user.department?.name,
      departmentCode: user.department?.code,
      department: user.department,
      studentId: user.studentId,
      sectionId: user.section?.id || user.sectionId,
      sectionName: user.section?.name,
      employeeId: user.employeeId,
      designation: user.designation,
      assignedSections: user.educatorSections?.map(rel => rel.section.id) || [],
      assignedSectionNames: user.educatorSections?.map(rel => rel.section.name).filter(Boolean) || [],
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }));
  }

  /**
   * Update user (Admin only) - supports educator and student specific fields
   */
  async updateUser(userId, updateData) {
    console.log('updateUser called with:', { userId, updateData });
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    console.log('Current user before update:', { 
      role: user.role, 
      departmentId: user.departmentId,
      assignedSections: user.assignedSections 
    });

    // Common fields that admin can update for all roles
    const commonFields = ['firstName', 'lastName', 'role', 'institutionId', 'departmentId', 'isActive'];
    
    // Educator-specific fields
    const educatorFields = ['employeeId', 'designation', 'assignedSections', 'qualification', 'specialization', 'experience', 'joiningDate'];
    
    // Student-specific fields
    const studentFields = ['studentId', 'sectionId', 'rollNumber', 'admissionYear', 'currentSemester'];

    // Apply common fields
    const updatePayload = {};
    for (const field of commonFields) {
      if (updateData[field] !== undefined) {
        console.log(`Setting ${field}:`, updateData[field]);
        updatePayload[field] = updateData[field];
      }
    }

    if (user.role === 'educator' || updateData.role === 'educator') {
      for (const field of educatorFields) {
        if (updateData[field] !== undefined) {
          console.log(`Setting educator field ${field}:`, updateData[field]);
          updatePayload[field] = updateData[field];
        }
      }
    }

    if (user.role === 'student' || updateData.role === 'student') {
      for (const field of studentFields) {
        if (updateData[field] !== undefined) {
          console.log(`Setting student field ${field}:`, updateData[field]);
          updatePayload[field] = updateData[field];
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: updatePayload,
      });

      if (updateData.assignedSections) {
        await tx.educatorSection.deleteMany({ where: { educatorId: userId } });
        if (updateData.assignedSections.length > 0) {
          await tx.educatorSection.createMany({
            data: updateData.assignedSections.map((sectionId) => ({
              educatorId: userId,
              sectionId,
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    logger.info('User updated by admin:', { userId, role: updateData.role || user.role, updates: Object.keys(updateData) });

    // Return updated user with role-specific fields
    const response = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      institutionId: user.institutionId,
      departmentId: user.departmentId,
      isActive: user.isActive,
    };

    if (user.role === 'educator') {
      response.employeeId = user.employeeId;
      response.designation = user.designation;
      response.assignedSections = updateData.assignedSections || [];
    }

    if (user.role === 'student') {
      response.studentId = user.studentId;
      response.sectionId = user.sectionId;
    }

    return response;
  }

  /**
   * Get all institutions
   */
  async getAllInstitutions() {
    const institutions = await prisma.institution.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return institutions.map(inst => ({
      id: inst.id,
      name: inst.name,
      code: inst.code,
    }));
  }
}

module.exports = new AuthService();
