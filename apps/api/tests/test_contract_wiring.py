import ast
import inspect
import textwrap

from fastapi.testclient import TestClient

from agent_school import main
from agent_school.service import School


def test_http_and_school_share_contracts(config, monkeypatch):
    loaded = []
    original = main.Contracts

    def load(root):
        value = original(root)
        loaded.append(value)
        return value

    monkeypatch.setattr(main, "Contracts", load)
    app = main.create_app(config)
    with TestClient(app, base_url="http://127.0.0.1:8000"):
        assert len(loaded) == 1
        assert app.state.school.contracts is loaded[0]
        assert app.state.school.catalog.contracts is loaded[0]
        exported = app.openapi()
        assert exported == loaded[0].openapi
        exported["info"]["title"] = "caller mutation"
        assert app.openapi() != exported


def test_contract_routes_and_dispatch_operations_match(config):
    app = main.create_app(config)
    spec = app.openapi()
    expected = {
        (method.upper(), "/api/v1" + path, operation["operationId"])
        for path, methods in spec["paths"].items()
        for method, operation in methods.items()
    }
    actual = {
        (method, route.path, route.name)
        for route in app.routes
        if route.path.startswith("/api/v1/")
        for method in route.methods
    }
    assert actual == expected
    tree = ast.parse(textwrap.dedent(inspect.getsource(School.dispatch)))
    dispatched = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and isinstance(node.left, ast.Name):
            if node.left.id == "operation":
                dispatched.update(
                    item.value
                    for value in node.comparators
                    for item in ast.walk(value)
                    if isinstance(item, ast.Constant) and isinstance(item.value, str)
                )
    assert dispatched == {operation for _, _, operation in expected}
