const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * @route GET /api/v1/tasks/my-tasks
 * @desc Get tasks assigned to current student
 * @access Private (Student)
 */
router.get('/my-tasks', authenticate, async (req, res) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });
    if (student.role !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Only students can view their tasks',
      });
    }

    const taskAssignments = await prisma.taskAssignment.findMany({
      where: { studentId: req.user.id },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            dueDate: true,
            totalMarks: true,
            instructions: true,
            createdBy: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      count: taskAssignments.length,
      data: taskAssignments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks',
      error: error.message,
    });
  }
});

/**
 * @route POST /api/v1/tasks
 * @desc Create a new task (educator)
 * @access Private (Educator)
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const educator = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });
    if (educator.role !== 'educator' && educator.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only educators can create tasks',
      });
    }

    const { title, description, courseId, taskType, dueDate, instructions, totalMarks } = req.body;

    if (!title || !courseId || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Title, courseId, and dueDate are required',
      });
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        courseId,
        taskType,
        dueDate: new Date(dueDate),
        instructions,
        totalMarks,
        createdById: req.user.id,
        status: 'draft',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: task,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: error.message,
    });
  }
});

/**
 * @route GET /api/v1/tasks/:taskId
 * @desc Get task details
 * @access Private
 */
router.get('/:taskId', authenticate, async (req, res) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.taskId },
      include: { createdBy: { select: { firstName: true, lastName: true, email: true } } },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    res.status(200).json({
      success: true,
      data: task,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch task',
      error: error.message,
    });
  }
});

/**
 * @route POST /api/v1/tasks/:taskId/assign
 * @desc Assign task to students
 * @access Private (Educator)
 */
router.post('/:taskId/assign', authenticate, async (req, res) => {
  try {
    const educator = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true },
    });
    if (educator.role !== 'educator' && educator.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only educators can assign tasks',
      });
    }

    const { taskId } = req.params;
    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one student ID is required',
      });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    await prisma.taskAssignment.createMany({
      data: studentIds.map((studentId) => ({
        taskId,
        studentId,
        assignedAt: new Date(),
      })),
      skipDuplicates: true,
    });

    res.status(201).json({
      success: true,
      message: `Task assigned to ${studentIds.length} student(s)`,
      data: { count: studentIds.length },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to assign task',
      error: error.message,
    });
  }
});

/**
 * @route PUT /api/v1/tasks/assignments/:assignmentId/submit
 * @desc Submit task assignment
 * @access Private (Student)
 */
router.put('/assignments/:assignmentId/submit', authenticate, async (req, res) => {
  try {
    const { submissionUrl, submissionText } = req.body;

    const assignment = await prisma.taskAssignment.findUnique({
      where: { id: req.params.assignmentId },
    });
    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (assignment.studentId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only submit your own assignments',
      });
    }

    const updated = await prisma.taskAssignment.update({
      where: { id: assignment.id },
      data: {
        submissionUrl,
        submissionStatus: 'submitted',
        submissionDate: new Date(),
        feedback: submissionText || undefined,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Assignment submitted successfully',
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to submit assignment',
      error: error.message,
    });
  }
});

module.exports = router;