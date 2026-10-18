import pytest


def test_two_services_cannot_share_one_local_database(client, config):
    from agent_school.service import School

    with pytest.raises(RuntimeError, match="already"):
        School(config)
