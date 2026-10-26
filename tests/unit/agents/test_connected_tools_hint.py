"""Current connector tools override stale capability claims in chat memory."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from langchain_core.messages import SystemMessage

from octop.infra.agents.middleware.connected_tools_hint import _with_connector_hint


def test_active_agent_mail_tool_adds_current_capability_hint() -> None:
    request = MagicMock()
    request.tools = [SimpleNamespace(name="agently-cli__mail_agently_send")]
    request.system_message = SystemMessage(content="Existing instructions.")
    request.override.side_effect = lambda **kwargs: SimpleNamespace(**kwargs)

    with patch(
        "octop.infra.agents.middleware.connected_tools_hint.runtime_config",
        return_value={"configurable": {"mcp_servers": ["agently-cli__mail"]}},
    ):
        updated = _with_connector_hint(request)

    content = " ".join(block["text"] for block in updated.system_message.content)
    assert "Existing instructions." in content
    assert "agently-cli__mail_agently_send" in content
    assert "Earlier assistant replies" in content
    assert "confirmation flow" in content
    assert "Always honor the user's explicit limits on tool use and data access" in content


def test_connector_hint_requires_a_selected_loaded_tool() -> None:
    request = MagicMock()
    request.tools = [SimpleNamespace(name="other_tool")]
    request.system_message = None

    with patch(
        "octop.infra.agents.middleware.connected_tools_hint.runtime_config",
        return_value={"configurable": {"mcp_servers": ["agently-cli__mail"]}},
    ):
        assert _with_connector_hint(request) is request
    request.override.assert_not_called()
