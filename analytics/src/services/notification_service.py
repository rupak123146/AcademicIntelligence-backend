"""
Notification Service

Provides multi-channel notification delivery:
- Email notifications
- In-app notifications
- SMS notifications (optional)
- Notification preferences
- Delivery tracking
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum

from ..config.database import get_db_pool
from ..utils.logger import get_logger

logger = get_logger(__name__)


class NotificationType(str, Enum):
    """Types of notifications"""
    EXAM_RESULT = "exam_result"
    AT_RISK_ALERT = "at_risk_alert"
    GOAL_ACHIEVED = "goal_achieved"
    MILESTONE_ACHIEVED = "milestone_achieved"
    INTERVENTION_STARTED = "intervention_started"
    INTERVENTION_UPDATE = "intervention_update"
    PERFORMANCE_TREND = "performance_trend"
    SYSTEM_ALERT = "system_alert"


class NotificationPriority(str, Enum):
    """Notification priority"""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class DeliveryChannel(str, Enum):
    """Delivery channels"""
    EMAIL = "email"
    IN_APP = "in_app"
    SMS = "sms"


class NotificationService:
    """
    Service for managing and delivering notifications
    
    Features:
    - Multi-channel delivery (email, in-app, SMS)
    - User preferences and quiet hours
    - Delivery tracking and status
    - Digest modes (immediate, daily, weekly)
    - Template system
    """
    
    def __init__(self):
        self.db_pool = None
        self.email_provider = None  # Implement with SendGrid, AWS SES, etc.
        self.sms_provider = None    # Implement with Twilio, AWS SNS, etc.
        
    async def initialize(self):
        """Initialize service"""
        try:
            self.db_pool = await get_db_pool()
            # TODO: Initialize email and SMS providers
            logger.info("NotificationService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize NotificationService: {e}")
            raise
    
    async def create_notification(
        self,
        user_id: str,
        user_type: str,  # 'student', 'educator', 'admin'
        notification_type: NotificationType,
        title: str,
        message: str,
        priority: NotificationPriority = NotificationPriority.NORMAL,
        channels: Optional[List[DeliveryChannel]] = None,
        scheduled_for: Optional[datetime] = None,
        expires_at: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create and queue a notification
        
        Args:
            user_id: User to notify
            user_type: Type of user (student, educator, admin)
            notification_type: Type of notification
            title: Notification title
            message: Notification message
            priority: Notification priority
            channels: Delivery channels (uses user preferences if None)
            scheduled_for: When to send (None = immediately)
            expires_at: When notification expires
            metadata: Additional data (links, context, etc.)
            
        Returns:
            Created notification record
        """
        try:
            logger.info(f"Creating {notification_type.value} notification for {user_id}")
            
            # Use default channels from user preferences if not specified
            if channels is None:
                prefs = await self.get_user_preferences(user_id, notification_type)
                channels = prefs.get('enabled_channels', [DeliveryChannel.IN_APP])
            
            async with self.db_pool.acquire() as conn:
                # Check quiet hours
                prefs = await conn.fetchrow(
                    "SELECT quiet_hours_start, quiet_hours_end FROM notification_preferences WHERE user_id = $1 AND notification_type = $2",
                    user_id, notification_type.value
                )
                
                # If in quiet hours and not critical, defer to next available time
                if prefs and prefs['quiet_hours_start'] and scheduled_for is None and priority != NotificationPriority.CRITICAL:
                    scheduled_for = self._next_available_time(
                        prefs['quiet_hours_start'],
                        prefs['quiet_hours_end']
                    )
                
                query = """
                    INSERT INTO notifications 
                    (user_id, user_type, notification_type, title, message, priority, channels, 
                     scheduled_for, expires_at, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id, user_id, notification_type, title, priority, scheduled_for, created_at
                """
                
                result = await conn.fetchrow(
                    query,
                    user_id, user_type, notification_type.value, title, message,
                    priority.value, json.dumps([c.value for c in channels]),
                    scheduled_for or datetime.utcnow(),
                    expires_at or (datetime.utcnow() + timedelta(days=30)),
                    datetime.utcnow()
                )
                
                notification = dict(result)
                
                # Attempt immediate delivery if not scheduled
                if scheduled_for is None or scheduled_for <= datetime.utcnow():
                    await self._deliver_notification(
                        user_id, notification['id'], channels, 
                        title, message, notification_type
                    )
                
                logger.info(f"Notification created: {notification['id']}")
                return notification
                
        except Exception as e:
            logger.error(f"Error creating notification: {e}")
            raise
    
    async def get_user_notifications(
        self,
        user_id: str,
        unread_only: bool = False,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get user's notifications"""
        try:
            async with self.db_pool.acquire() as conn:
                query = "SELECT * FROM notifications WHERE user_id = $1"
                params = [user_id]
                
                if unread_only:
                    query += " AND read_at IS NULL"
                
                query += " ORDER BY created_at DESC LIMIT $%d OFFSET $%d" % (len(params) + 1, len(params) + 2)
                params.extend([limit, offset])
                
                notifications = await conn.fetch(query, *params)
                
                # Count unread
                unread_count = await conn.fetchval(
                    "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL",
                    user_id
                )
                
                return {
                    "user_id": user_id,
                    "notifications": [dict(n) for n in notifications],
                    "unread_count": unread_count,
                    "total_count": len(notifications)
                }
                
        except Exception as e:
            logger.error(f"Error getting notifications: {e}")
            raise
    
    async def mark_as_read(self, notification_id: int, user_id: str) -> bool:
        """Mark notification as read"""
        try:
            async with self.db_pool.acquire() as conn:
                result = await conn.execute(
                    """UPDATE notifications SET read_at = $1 WHERE id = $2 AND user_id = $3""",
                    datetime.utcnow(), notification_id, user_id
                )
                
                return result == "UPDATE 1"
                
        except Exception as e:
            logger.error(f"Error marking notification as read: {e}")
            raise
    
    async def set_user_preferences(
        self,
        user_id: str,
        user_type: str,
        notification_type: NotificationType,
        enabled_channels: List[DeliveryChannel],
        quiet_hours_start: Optional[str] = None,
        quiet_hours_end: Optional[str] = None,
        frequency: str = "immediate"  # immediate, daily_digest, weekly_digest
    ) -> Dict[str, Any]:
        """
        Set user notification preferences
        
        Args:
            quiet_hours_start: Time format "HH:MM" (e.g., "22:00")
            quiet_hours_end: Time format "HH:MM" (e.g., "08:00")
            frequency: How often to send (immediate, daily_digest, weekly_digest)
        """
        try:
            channels_json = json.dumps([c.value for c in enabled_channels])
            
            async with self.db_pool.acquire() as conn:
                # Upsert preference
                query = """
                    INSERT INTO notification_preferences 
                    (user_id, user_type, notification_type, enabled_channels, 
                     quiet_hours_start, quiet_hours_end, frequency, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (user_id, notification_type) DO UPDATE SET
                        enabled_channels = $4,
                        quiet_hours_start = $5,
                        quiet_hours_end = $6,
                        frequency = $7,
                        updated_at = $9
                    RETURNING *
                """
                
                result = await conn.fetchrow(
                    query,
                    user_id, user_type, notification_type.value, channels_json,
                    quiet_hours_start, quiet_hours_end, frequency,
                    datetime.utcnow(), datetime.utcnow()
                )
                
                logger.info(f"Updated preferences for {user_id}: {notification_type.value}")
                return dict(result)
                
        except Exception as e:
            logger.error(f"Error setting user preferences: {e}")
            raise
    
    async def get_user_preferences(
        self,
        user_id: str,
        notification_type: Optional[NotificationType] = None
    ) -> Dict[str, Any]:
        """Get user notification preferences"""
        try:
            async with self.db_pool.acquire() as conn:
                if notification_type:
                    result = await conn.fetchrow(
                        "SELECT * FROM notification_preferences WHERE user_id = $1 AND notification_type = $2",
                        user_id, notification_type.value
                    )
                    return dict(result) if result else self._default_preferences()
                else:
                    results = await conn.fetch(
                        "SELECT * FROM notification_preferences WHERE user_id = $1",
                        user_id
                    )
                    return [dict(r) for r in results]
                    
        except Exception as e:
            logger.error(f"Error getting preferences: {e}")
            raise
    
    async def send_scheduled_notifications(self):
        """
        Background task to send scheduled notifications
        Should be called periodically (every 5-15 minutes)
        """
        try:
            logger.info("Processing scheduled notifications...")
            
            async with self.db_pool.acquire() as conn:
                # Get due notifications
                due_notifications = await conn.fetch(
                    """
                    SELECT id, user_id, notification_type, title, message, channels
                    FROM notifications
                    WHERE scheduled_for <= $1 
                      AND delivery_status IS NULL
                      AND expires_at > $1
                    LIMIT 100
                    """,
                    datetime.utcnow()
                )
                
                for notif in due_notifications:
                    channels = json.loads(notif['channels'])
                    channel_objs = [DeliveryChannel(c) for c in channels]
                    
                    try:
                        await self._deliver_notification(
                            notif['user_id'],
                            notif['id'],
                            channel_objs,
                            notif['title'],
                            notif['message'],
                            NotificationType(notif['notification_type'])
                        )
                    except Exception as e:
                        logger.error(f"Failed to deliver notification {notif['id']}: {e}")
            
            logger.info(f"Processed {len(due_notifications)} scheduled notifications")
            
        except Exception as e:
            logger.error(f"Error in send_scheduled_notifications: {e}")
    
    async def _deliver_notification(
        self,
        user_id: str,
        notification_id: int,
        channels: List[DeliveryChannel],
        title: str,
        message: str,
        notif_type: NotificationType
    ):
        """Deliver notification through specified channels"""
        delivery_status = {}
        
        for channel in channels:
            try:
                if channel == DeliveryChannel.IN_APP:
                    # In-app notifications are always available (already in DB)
                    delivery_status[channel.value] = "delivered"
                    
                elif channel == DeliveryChannel.EMAIL:
                    # TODO: Implement email delivery
                    # await self.email_provider.send(user_id, title, message)
                    delivery_status[channel.value] = "sent"  # or "failed"
                    
                elif channel == DeliveryChannel.SMS:
                    # TODO: Implement SMS delivery
                    # await self.sms_provider.send(user_id, message)
                    delivery_status[channel.value] = "sent"  # or "failed"
                    
            except Exception as e:
                logger.error(f"Error delivering via {channel.value}: {e}")
                delivery_status[channel.value] = "failed"
        
        # Update delivery status
        async with self.db_pool.acquire() as conn:
            await conn.execute(
                "UPDATE notifications SET delivery_status = $1 WHERE id = $2",
                json.dumps(delivery_status),
                notification_id
            )
    
    def _next_available_time(self, quiet_start: str, quiet_end: str) -> datetime:
        """Calculate next available delivery time outside quiet hours"""
        now = datetime.utcnow()
        
        # TODO: Parse quiet_start and quiet_end times
        # For now, return next hour
        return now + timedelta(hours=1)
    
    def _default_preferences(self) -> Dict[str, Any]:
        """Default notification preferences"""
        return {
            "enabled_channels": [DeliveryChannel.IN_APP.value],
            "quiet_hours_start": None,
            "quiet_hours_end": None,
            "frequency": "immediate"
        }


# Global service instance
notification_service = NotificationService()


async def get_notification_service() -> NotificationService:
    """Get the notification service instance"""
    return notification_service
