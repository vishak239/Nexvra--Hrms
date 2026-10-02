from django.contrib import admin

from .models import Conversation, ConversationParticipant

# Message bodies and attachments are deliberately not registered: they are private to participants.
for model in (Conversation, ConversationParticipant):
    admin.site.register(model)
