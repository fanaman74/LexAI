"""Tests for the hybrid search endpoint."""
import pytest


def test_search_empty_query(client):
    resp = client.get("/api/search?q=")
    assert resp.status_code == 400


def test_search_returns_results_shape(client):
    """Search with no indexed docs should return empty results list, not error."""
    resp = client.get("/api/search?q=contract")
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert "query" in data
    assert isinstance(data["results"], list)
