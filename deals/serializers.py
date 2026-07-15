from rest_framework import serializers

from contacts.models import Contact

from .models import Deal, DealHistory, SalesStage


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


class ContactSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ('id', 'name', 'company', 'phone')


class ContactDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ('id', 'name', 'company', 'phone', 'email', 'telegram')


class StageReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesStage
        fields = ('id', 'name', 'is_system', 'is_final', 'order', 'version')


class DealListSerializer(serializers.ModelSerializer):
    contact = serializers.SerializerMethodField()

    class Meta:
        model = Deal
        fields = (
            'id', 'name', 'version', 'amount', 'currency', 'contact',
            'created_at', 'updated_at',
        )

    def get_contact(self, obj):
        if obj.contact is None or obj.contact.is_deleted:
            return None
        return ContactSummarySerializer(obj.contact).data


class DealDetailSerializer(serializers.ModelSerializer):
    stage_id = serializers.UUIDField(source='stage.id', read_only=True)
    contact = serializers.SerializerMethodField()

    class Meta:
        model = Deal
        fields = (
            'id', 'name', 'amount', 'currency', 'stage_id', 'version',
            'comment', 'ai_insights', 'contact', 'created_at', 'updated_at',
        )

    def get_contact(self, obj):
        if obj.contact is None or obj.contact.is_deleted:
            return None
        return ContactDetailSerializer(obj.contact).data


class DealCreateSerializer(StrictSerializer):
    name = serializers.CharField(max_length=255)
    amount = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        min_value=0,
        required=False,
        allow_null=True,
    )
    currency = serializers.CharField(max_length=3, required=False, default='RUB')
    contact_id = serializers.UUIDField(required=False, allow_null=True)
    comment = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Название сделки обязательно.')
        return value

    def validate_currency(self, value):
        if value != 'RUB':
            raise serializers.ValidationError('В MVP поддерживается только RUB.')
        return value

    def validate_comment(self, value):
        return nullable_trimmed(value)


class DealUpdateSerializer(StrictSerializer):
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=255, required=False)
    amount = serializers.DecimalField(
        max_digits=15,
        decimal_places=2,
        min_value=0,
        required=False,
        allow_null=True,
    )
    comment = serializers.CharField(
        max_length=500,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    contact_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Название сделки обязательно.')
        return value

    def validate_comment(self, value):
        return nullable_trimmed(value)


class DealStageUpdateSerializer(StrictSerializer):
    stage_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)


class StageCreateSerializer(StrictSerializer):
    name = serializers.CharField(max_length=100)
    is_final = serializers.BooleanField(required=False, default=False)
    order = serializers.IntegerField(min_value=2, max_value=20, required=False)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Название этапа обязательно.')
        return value


class StageUpdateSerializer(StageCreateSerializer):
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=100, required=False)
    is_final = serializers.BooleanField(required=False)


class DealHistorySerializer(serializers.ModelSerializer):
    changed_by_id = serializers.UUIDField(source='changed_by.id', allow_null=True)

    class Meta:
        model = DealHistory
        fields = (
            'id', 'event_type', 'changed_by_type', 'changed_by_id', 'changes',
            'reason', 'correlation_id', 'created_at',
        )
