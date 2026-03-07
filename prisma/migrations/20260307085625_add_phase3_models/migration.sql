-- CreateTable
CREATE TABLE `goals` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `goalType` ENUM('score_improvement', 'concept_mastery', 'consistency', 'time_management') NOT NULL,
    `targetValue` DOUBLE NOT NULL,
    `currentValue` DOUBLE NOT NULL DEFAULT 0,
    `targetDate` DATETIME(3) NOT NULL,
    `status` ENUM('active', 'completed', 'cancelled', 'expired') NOT NULL DEFAULT 'active',
    `description` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `goals_studentId_status_idx`(`studentId`, `status`),
    INDEX `goals_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NULL,
    `notificationType` ENUM('exam_reminder', 'result_published', 'goal_milestone', 'intervention_alert', 'achievement_unlocked', 'deadline_approaching') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `actionUrl` VARCHAR(191) NULL,
    `priority` ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_isRead_idx`(`userId`, `isRead`),
    INDEX `notifications_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `examReminders` BOOLEAN NOT NULL DEFAULT true,
    `resultNotifications` BOOLEAN NOT NULL DEFAULT true,
    `goalMilestones` BOOLEAN NOT NULL DEFAULT true,
    `interventionAlerts` BOOLEAN NOT NULL DEFAULT true,
    `achievements` BOOLEAN NOT NULL DEFAULT true,
    `emailNotifications` BOOLEAN NOT NULL DEFAULT false,
    `preferences` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_preferences_studentId_key`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interventions` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `educatorId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `interventionType` ENUM('one_on_one_tutoring', 'group_study', 'additional_resources', 'peer_mentoring', 'remedial_classes') NOT NULL,
    `status` ENUM('planned', 'active', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
    `reason` TEXT NOT NULL,
    `plannedActions` TEXT NOT NULL,
    `targetMetrics` JSON NULL,
    `estimatedDuration` INTEGER NULL,
    `actualStartDate` DATETIME(3) NULL,
    `completionDate` DATETIME(3) NULL,
    `outcome` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `interventions_studentId_status_idx`(`studentId`, `status`),
    INDEX `interventions_educatorId_status_idx`(`educatorId`, `status`),
    INDEX `interventions_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `intervention_checkins` (
    `id` VARCHAR(191) NOT NULL,
    `interventionId` VARCHAR(191) NOT NULL,
    `progress` VARCHAR(191) NOT NULL,
    `observations` TEXT NOT NULL,
    `nextSteps` TEXT NULL,
    `metricsUpdate` JSON NULL,
    `checkinDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `intervention_checkins_interventionId_idx`(`interventionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `goals` ADD CONSTRAINT `goals_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `intervention_checkins` ADD CONSTRAINT `intervention_checkins_interventionId_fkey` FOREIGN KEY (`interventionId`) REFERENCES `interventions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
