import importlib.util
import json
import threading
import unittest
from functools import partial
from html.parser import HTMLParser
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "review", ROOT / "skills/opensquad-skill-creator/eval-viewer/generate_review.py"
)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ViewerTests(unittest.TestCase):
    def test_output_cannot_create_an_html_element(self):
        attack = '</script><img src=x onerror="alert(1)"><script>'
        html = review.generate_html([{"prompt": attack, "outputs": []}], attack)

        class Tags(HTMLParser):
            found = False

            def handle_starttag(self, tag, attrs):
                if any(key == "onerror" for key, _ in attrs):
                    self.found = True

        tags = Tags()
        tags.feed(html)
        self.assertFalse(tags.found)
        embedded = html.split("const EMBEDDED_DATA = ", 1)[1].split(";\n", 1)[0]
        self.assertEqual(json.loads(embedded)["runs"][0]["prompt"], attack)

    def test_feedback_requires_trusted_host_origin_and_token(self):
        with TemporaryDirectory() as directory:
            workspace = Path(directory)
            feedback = workspace / "feedback.json"
            handler = partial(review.ReviewHandler, workspace, "test", feedback, {}, None)
            server = HTTPServer(("127.0.0.1", 0), handler)
            server.csrf_token = "test-token"
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_port

                def request(method, headers, body=None):
                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request(method, "/api/feedback", body, headers)
                    result = conn.getresponse()
                    status = result.status
                    result.read()
                    conn.close()
                    return status

                body = json.dumps({"reviews": [], "status": "complete"})
                headers = {"Content-Type": "application/json"}
                self.assertEqual(request("POST", headers, body), 403)
                self.assertFalse(feedback.exists())
                headers["X-Review-Token"] = "test-token"
                headers["Origin"] = "https://evil.example"
                self.assertEqual(request("POST", headers, body), 403)
                headers["Origin"] = f"http://127.0.0.1:{port}"
                self.assertEqual(request("POST", headers, body), 200)
                self.assertEqual(json.loads(feedback.read_text())["status"], "complete")
                self.assertEqual(request("GET", {"Host": "evil.example"}), 403)
            finally:
                server.shutdown()
                thread.join()
                server.server_close()

    def test_bundled_skills_validate_and_traversal_does_not(self):
        spec = importlib.util.spec_from_file_location(
            "validator", ROOT / "skills/opensquad-skill-creator/scripts/quick_validate.py"
        )
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        for skill in (ROOT / "skills").iterdir():
            if (skill / "SKILL.md").exists():
                valid, message = validator.validate_skill(skill)
                self.assertTrue(valid, f"{skill.name}: {message}")
        with TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "SKILL.md").write_text(
                '---\nname: test\ndescription: Test\ntype: script\nversion: "1.0.0"\n'
                'script:\n  runtime: python\n  path: ../secret.py\n---\n', encoding="utf-8"
            )
            self.assertFalse(validator.validate_skill(path)[0])


if __name__ == "__main__":
    unittest.main()
