from rest_framework import serializers

from contacts.models import Contact
from deals.models import Deal

from .dates import infer_due_date_type, is_task_overdue, normalize_due_date
from .models import DueDateType, Task, TaskHistory, TaskStatus


def nullable_trimmed(value):
    if value is None:
        return None
    value = value.strip()
    return value or None


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {field: 'Неизвестное поле.' for field in sorted(unknown)},
            )
        return super().to_internal_value(data)


class FlexibleDueDateField(serializers.Field):
    def to_internal_value(self, data):
        return normalize_due_date(
            data,
            workspace=self.parent.context['workspace'],
        )

    def to_representation(self, value):
        return serializers.DateTimeField().to_representation(value)


class ContactTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ('id', 'name', 'company')


class DealTaskSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source='name')

    class Meta:
        model = Deal
        fields = ('id', 'title', 'amount', 'currency')


class TaskReadSerializerBase(serializers.ModelSerializer):
    contact = serializers.SerializerMethodField()
    deal = serializers.SerializerMethodField()
    created_by_user_id = serializers.UUIDField(read_only=True, allow_null=True)
    is_overdue = serializers.SerializerMethodField()

    def get_contact(self, obj):
        if obj.contact is None or obj.contact.is_deleted:
            return None
        return ContactTaskSerializer(obj.contact).data

    def get_deal(self, obj):
        if obj.deal is None or obj.deal.is_deleted:
            return None
        return DealTaskSerializer(obj.deal).data

    def get_is_overdue(self, obj):
        return is_task_overdue(obj)


class TaskListSerializer(TaskReadSerializerBase):
    class Meta:
        model = Task
        fields = (
            'id', 'title', 'due_date', 'due_date_type', 'status', 'contact',
            'deal', 'created_by_ai', 'created_by_user_id', 'version',
            'is_overdue', 'created_at', 'updated_at',
        )


class TaskDetailSerializer(TaskReadSerializerBase):
    class Meta:
        model = Task
        fields = (
            'id', 'title', 'description', 'due_date', 'due_date_type',
            'status', 'contact', 'deal', 'comment', 'created_by_ai',
            'created_by_user_id', 'version', 'is_overdue', 'created_at',
            'updated_at',
        )


class TaskValidationMixin:
    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Название задачи обязательно.')
        return value

    def validate_description(self, value):
        return nullable_trimmed(value)

    def validate_comment(self, value):
        return nullable_trimmed(value)

    def infer_due_type(self, due_date):
        return infer_due_date_type(
            due_date,
            workspace=self.context['workspace'],
        )


class TaskCreateSerializer(TaskValidationMixin, StrictSerializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    due_date = FlexibleDueDateField(required=False, allow_null=True)
    due_date_type = serializers.ChoiceField(
        choices=DueDateType.choices,
        required=False,
    )
    contact_id = serializers.UUIDField(required=False, allow_null=True)
    deal_id = serializers.UUIDField(required=False, allow_null=True)
    comment = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    def validate(self, attrs):
        due_date_present = 'due_date' in attrs
        due_type_present = 'due_date_type' in attrs
        due_date = attrs.get('due_date')
        due_type = attrs.get('due_date_type')

        if not due_date_present:
            if due_type_present and due_type != DueDateType.NONE:
                raise serializers.ValidationError({
                    'due_date': 'Дата выполнения обязательна для выбранного типа срока.',
                })
            attrs['due_date'] = None
            attrs['due_date_type'] = DueDateType.NONE
            return attrs

        if due_date is None:
            if due_type_present and due_type != DueDateType.NONE:
                raise serializers.ValidationError({
                    'due_date_type': 'Для due_date=null укажите due_date_type=none.',
                })
            attrs['due_date_type'] = DueDateType.NONE
            return attrs

        if not due_type_present:
            attrs['due_date_type'] = self.infer_due_type(due_date)
            return attrs

        if due_type == DueDateType.NONE:
            raise serializers.ValidationError({
                'due_date': 'Для задачи без срока due_date должен быть null.',
            })
        return attrs


class TaskUpdateSerializer(TaskValidationMixin, StrictSerializer):
    version = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    due_date = FlexibleDueDateField(required=False, allow_null=True)
    due_date_type = serializers.ChoiceField(
        choices=DueDateType.choices,
        required=False,
    )
    contact_id = serializers.UUIDField(required=False, allow_null=True)
    deal_id = serializers.UUIDField(required=False, allow_null=True)
    comment = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    def validate(self, attrs):
        due_date_present = 'due_date' in attrs
        due_type_present = 'due_date_type' in attrs

        if not due_date_present:
            return attrs

        due_date = attrs.get('due_date')
        due_type = attrs.get('due_date_type')

        if due_date is None:
            if not due_type_present or due_type != DueDateType.NONE:
                raise serializers.ValidationError({
                    'due_date_type': 'При очистке срока укажите due_date_type=none.',
                })
            return attrs

        if not due_type_present:
            attrs['due_date_type'] = self.infer_due_type(due_date)
            return attrs

        if due_type == DueDateType.NONE:
            raise serializers.ValidationError({
                'due_date': 'Для задачи без срока передайте due_date=null.',
            })
        return attrs


class TaskStatusSerializer(StrictSerializer):
    status = serializers.ChoiceField(choices=TaskStatus.choices)
    version = serializers.IntegerField(min_value=1)


class TaskBulkDeleteSerializer(StrictSerializer):
    task_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
    )

    def validate_task_ids(self, value):
        unique = list(dict.fromkeys(value))
        if len(unique) > 100:
            raise serializers.ValidationError(
                'Можно удалить не более 100 уникальных задач.',
            )
        return unique


class TaskHistorySerializer(serializers.ModelSerializer):
    user_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = TaskHistory
        fields = (
            'id', 'event', 'source', 'user_id', 'created_at', 'data',
            'changes', 'correlation_id',
        )
