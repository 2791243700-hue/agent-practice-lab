import io
import json
import zipfile
from conftest import create_attempt, post
from test_runs import start, wait_run
from test_credentials import make_profile, configure

def test_export_freezes_learning_data_and_excludes_model_connections(client):
    configure(client,make_profile(client))
    a=create_attempt(client)
    run=start(client,a);wait_run(client,run["id"])
    response=post(client,"/attempts/"+a["id"]+"/exports",{"expected_revision":1},"export-operation-key")
    assert response.status_code==201,response.text
    info=response.json()
    raw=client.get("/api/v1/exports/"+info["id"]+"/download")
    assert raw.status_code==200
    assert raw.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(raw.content)) as archive:
        assert "learning.json" in archive.namelist()
        content=archive.read("learning.json").decode()
        assert "secret-test-key" not in content
        assert "https://model.example" not in content
        assert "profile_id" not in content
        assert "test-local-token" not in content
    assert client.get("/api/v1/exports/"+info["id"]).json()==info
