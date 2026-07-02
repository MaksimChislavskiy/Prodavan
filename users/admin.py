from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    DeletedEmailReservation,
    PasswordResetToken,
    ProfileAuditLog,
    RefreshToken,
    RegistrationToken,
    User,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        'email', 'first_name', 'last_name', 'workspace', 'role',
        'is_confirmed', 'is_active', 'is_deleted', 'version', 'created_at',
    )
    list_filter = ('role', 'is_confirmed', 'is_active', 'is_deleted', 'tariff')
    search_fields = ('email', 'first_name', 'last_name')
    ordering = ('email',)
    readonly_fields = (
        'created_at', 'updated_at', 'last_login', 'deleted_at',
        'version', 'token_version',
    )

    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Личная информация', {
            'fields': (
                'first_name', 'last_name', 'position', 'phone_number',
                'avatar', 'avatar_small', 'avatar_medium',
            ),
        }),
        ('Workspace и роль', {'fields': ('workspace', 'role')}),
        ('Тариф', {'fields': ('tariff', 'tariff_balance')}),
        ('Статус', {
            'fields': (
                'is_confirmed', 'is_active', 'is_deleted', 'version',
                'token_version', 'deleted_at',
            ),
        }),
        ('Права Django', {
            'fields': ('is_staff', 'is_superuser', 'groups', 'user_permissions'),
        }),
        ('Важные даты', {'fields': ('last_login', 'created_at', 'updated_at')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': (
                'email', 'first_name', 'last_name', 'workspace', 'role',
                'password1', 'password2', 'is_confirmed',
            ),
        }),
    )


@admin.register(RegistrationToken)
class RegistrationTokenAdmin(admin.ModelAdmin):
    list_display = ('email', 'attempts', 'expired', 'code_expires_at', 'created_at')
    search_fields = ('email',)
    readonly_fields = ('password_hash', 'confirmation_code_hash')


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'attempts', 'used', 'code_expires_at', 'created_at')
    search_fields = ('user__email',)
    readonly_fields = ('reset_code_hash',)


@admin.register(RefreshToken)
class RefreshTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'revoked', 'expires_at', 'created_at')
    list_filter = ('revoked',)
    search_fields = ('user__email',)
    readonly_fields = ('token_hash',)


@admin.register(DeletedEmailReservation)
class DeletedEmailReservationAdmin(admin.ModelAdmin):
    list_display = ('user_identifier', 'deleted_at', 'release_at')
    search_fields = ('user_identifier', 'email_hash')
    readonly_fields = ('email_hash',)


@admin.register(ProfileAuditLog)
class ProfileAuditLogAdmin(admin.ModelAdmin):
    list_display = ('user_identifier', 'action', 'ip_address', 'created_at')
    list_filter = ('action',)
    search_fields = ('user_identifier', 'user__email')
    readonly_fields = (
        'user', 'user_identifier', 'action', 'changes', 'ip_address',
        'user_agent', 'created_at',
    )
