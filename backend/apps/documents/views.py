from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.audit import services as audit
from apps.core.files import DOCUMENT_EXTENSIONS, private_file_response, validate_upload
from apps.core.permissions import SCOPE_ALL, HasPermission, get_scope
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from .models import EmployeeDocument
from .serializers import DocumentUpdateSerializer, DocumentUploadSerializer, EmployeeDocumentSerializer


class DocumentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Files live in private storage and are only reachable via the `download` action,
    after the same permission + scope checks as the metadata."""

    serializer_class = EmployeeDocumentSerializer
    permission_classes = [HasPermission]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    required_permissions = {
        "list": ("documents.view_own", "documents.view_all"),
        "retrieve": ("documents.view_own", "documents.view_all"),
        "download": ("documents.view_own", "documents.view_all"),
        "create": ("documents.manage", "documents.view_own"),  # own uploads re-checked below
        "update": ("documents.manage",),
        "partial_update": ("documents.manage",),
        "destroy": ("documents.manage",),
    }
    filterset_fields = ["employee", "category"]
    search_fields = ["title", "original_filename"]

    def get_queryset(self):
        qs = EmployeeDocument.objects.select_related("employee__user", "uploaded_by")
        if get_scope(self.request.user, "documents") == SCOPE_ALL:
            return qs
        return qs.filter(employee__user=self.request.user, visible_to_employee=True)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        ser = DocumentUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        employee = data["employee"]
        own_upload = employee.user_id == request.user.pk
        if not request.user.has_permission("documents.manage"):
            if not (own_upload and CompanySettings.get_solo().employee_document_upload_enabled):
                raise PermissionDenied("You cannot upload documents for this employee.")
            data["visible_to_employee"] = True
        upload = data["file"]
        ext, content_type = validate_upload(upload, DOCUMENT_EXTENSIONS)
        doc = EmployeeDocument(
            employee=employee,
            category=data["category"],
            title=data["title"],
            original_filename=upload.name[:255],
            content_type=content_type,
            size=upload.size,
            visible_to_employee=data["visible_to_employee"],
            uploaded_by=request.user,
        )
        doc.file.save(upload.name, upload, save=False)
        doc.save()
        if doc.visible_to_employee and not own_upload:
            notify(
                [employee.user],
                Notification.Type.DOCUMENT_SHARED,
                f"New document: {doc.title}",
                doc.get_category_display(),
                obj=doc,
            )
        audit.record(
            request,
            "DOCUMENT_UPLOADED",
            obj=doc,
            metadata={"employee": employee.pk, "category": doc.category, "size": doc.size},
        )
        return Response(self.get_serializer(doc).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        doc = self.get_object()
        ser = DocumentUpdateSerializer(doc, data=request.data, partial=kwargs.pop("partial", False))
        ser.is_valid(raise_exception=True)
        fields = list(ser.validated_data)
        before = audit.snapshot(doc, fields)
        doc = ser.save()
        audit.record(request, "DOCUMENT_UPDATED", obj=doc, changes=audit.diff(before, audit.snapshot(doc, fields)))
        return Response(self.get_serializer(doc).data)

    def perform_destroy(self, doc):
        audit.record(
            self.request,
            "DOCUMENT_DELETED",
            obj=doc,
            metadata={"employee": doc.employee_id, "title": doc.title, "category": doc.category},
        )
        storage, name = doc.file.storage, doc.file.name
        doc.delete()
        transaction.on_commit(lambda: storage.delete(name))

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        doc = self.get_object()
        audit.record(request, "DOCUMENT_DOWNLOADED", obj=doc, metadata={"employee": doc.employee_id})
        return private_file_response(doc.file, doc.original_filename, doc.content_type)
