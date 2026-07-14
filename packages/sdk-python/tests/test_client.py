from __future__ import annotations

import unittest
import base64
import json
from unittest.mock import patch

from nian_sdk import NIANClient


class ClientTests(unittest.TestCase):
    def test_normalizes_base_url_and_defaults(self) -> None:
        client = NIANClient("https://knowledge.test/nian/0.1/", "token")

        self.assertEqual(client.base_url, "https://knowledge.test/nian/0.1")
        self.assertEqual(client.supported_obligations, ("cite", "no-train"))

    def test_contribution_is_submitted_only_as_a_candidate(self) -> None:
        client = NIANClient("https://knowledge.test/nian/0.1", "token")
        contribution = {"nianVersion": "0.1", "kind": "create"}

        with patch.object(client, "_request", return_value={"status": "candidate"}) as request:
            result = client.contribute(contribution)

        self.assertEqual(result, {"status": "candidate"})
        _, kwargs = request.call_args
        self.assertEqual(kwargs["method"], "POST")
        self.assertEqual(kwargs["body"], contribution)
        self.assertTrue(kwargs["idempotency_key"].startswith("sdk-contribution-"))

    def test_revision_returns_read_receipt_and_canonicalizes_obligations(self) -> None:
        class Response:
            headers = {
                "NIAN-Read-Receipt": "urn:uuid:00000000-0000-4000-8000-000000000001",
                "NIAN-Quality-Decision": "suitable",
            }

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self) -> bytes:
                return b'{"revisionId":"urn:nian:sha256:test"}'

        client = NIANClient(
            "https://knowledge.test/nian/0.1",
            "token",
            supported_obligations=(
                "cite",
                {"uri": "https://knowledge.test/obligations/retain", "digest": "sha256:test"},
            ),
        )
        with patch("nian_sdk.client.urlopen", return_value=Response()) as open_request:
            result = client.get_revision(
                "https://knowledge.test/spaces/support",
                "urn:nian:sha256:test",
                "customer-support",
            )

        self.assertEqual(
            result["exposureReceiptId"],
            "urn:uuid:00000000-0000-4000-8000-000000000001",
        )
        # get_revision performs the Revision read first and then resolves its
        # Exposure Receipt. Inspect the first request, not the final receipt
        # lookup which intentionally carries no direct-read headers.
        request = open_request.call_args_list[0].args[0]
        encoded = dict(
            (name.lower(), value) for name, value in request.header_items()
        )["nian-obligation-support"]
        decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
        self.assertEqual(
            decoded,
            json.dumps(client.supported_obligations, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        )


if __name__ == "__main__":
    unittest.main()
