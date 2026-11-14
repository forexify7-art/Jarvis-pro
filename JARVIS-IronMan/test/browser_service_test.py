import asyncio
import importlib.util
import json
import socket
import sys
import threading
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from http.client import HTTPConnection


SERVICE_PATH = Path(__file__).parents[1] / 'browser' / 'jarvis_browser_service.py'
SPEC = importlib.util.spec_from_file_location('jarvis_browser_service', SERVICE_PATH)
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class BrowserServiceValidationTests(unittest.TestCase):
	def test_rejects_non_http_schemes_and_local_destinations(self):
		for url in (
			'file:///etc/passwd',
			'ftp://example.com/file',
			'http://127.0.0.1/',
			'http://192.168.1.1/',
			'https://localhost/',
			'https://service.internal/',
			'https://example.com,MAP 127.0.0.1/',
			'https://example.com:8443/',
		):
			with self.subTest(url=url), self.assertRaises(ValueError):
				SERVICE.validate_public_url(url)

	def test_rejects_credentials_and_invalid_url_types(self):
		for url in ('https://user:password@example.com/', None, ''):
			with self.subTest(url=url), self.assertRaises(ValueError):
				SERVICE.validate_public_url(url)

	def test_accepts_public_dns_and_rejects_private_dns_results(self):
		public_addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]
		with patch.object(SERVICE.socket, 'getaddrinfo', return_value=public_addresses):
			self.assertEqual(
				SERVICE.validate_public_url('https://example.com/article'),
				('https://example.com/article', 'example.com', '8.8.8.8'),
			)

		private_addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.8', 443))]
		with patch.object(SERVICE.socket, 'getaddrinfo', return_value=private_addresses):
			with self.assertRaisesRegex(ValueError, 'public IP addresses'):
				SERVICE.validate_public_url('https://example.com/article')

	def test_host_resolver_rule_accepts_only_public_addresses(self):
		self.assertEqual(
			SERVICE.build_host_resolver_rule('example.com', '2001:4860:4860::8888'),
			'--host-resolver-rules=MAP example.com [2001:4860:4860::8888]',
		)
		with self.assertRaisesRegex(ValueError, 'public IP addresses'):
			SERVICE.build_host_resolver_rule('example.com', '10.0.0.8')

	def test_research_pins_browser_resolution_to_the_validated_public_address(self):
		profile_options = {}

		class FakeBrowserProfile:
			def __init__(self, **options):
				profile_options.update(options)

		class FakeTools:
			def __init__(self):
				self.registry = SimpleNamespace(actions={})

			def exclude_action(self, _action_name):
				return None

		class FakeAgent:
			def __init__(self, **_options):
				return None

			async def run(self, **_options):
				return SimpleNamespace(final_result=lambda: 'Readable page.')

		browser_module = ModuleType('browser_use')
		browser_module.Agent = FakeAgent
		browser_module.BrowserProfile = FakeBrowserProfile
		tools_package = ModuleType('browser_use.tools')
		tools_module = ModuleType('browser_use.tools.service')
		tools_module.Tools = FakeTools
		public_addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]

		with (
			patch.dict(sys.modules, {
				'browser_use': browser_module,
				'browser_use.tools': tools_package,
				'browser_use.tools.service': tools_module,
			}),
			patch.object(SERVICE, 'build_llm', return_value=object()),
			patch.object(SERVICE.socket, 'getaddrinfo', return_value=public_addresses),
		):
			result = asyncio.run(SERVICE.research_page({
				'url': 'https://example.com/article',
				'question': 'Summarize it',
				'provider': 'gemini',
				'model': 'test-model',
				'apiKey': 'test-key',
			}))

		self.assertEqual(result, 'Readable page.')
		args = profile_options.get('args', [])
		self.assertIn('--host-resolver-rules=MAP example.com 8.8.8.8', args)
		self.assertTrue(any(arg.startswith('--proxy-server=http://127.0.0.1:') for arg in args))
		self.assertIn('--proxy-bypass-list=<-loopback>', args)
		self.assertIn('--dns-prefetch-disable', args)
		self.assertIn('--disable-quic', args)
		self.assertIn('--force-webrtc-ip-handling-policy=disable_non_proxied_udp', args)

	def test_egress_proxy_blocks_private_dns_for_each_http_request(self):
		private_addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('169.254.169.254', 80))]
		with SERVICE.PublicEgressProxy() as proxy:
			for path in ('redirect', 'image.png'):
				connection = HTTPConnection('127.0.0.1', proxy.port, timeout=2)
				connection.connect()
				try:
					with (
						patch.object(SERVICE.socket, 'getaddrinfo', return_value=private_addresses),
						patch.object(SERVICE, 'HTTPConnection') as open_upstream,
					):
						connection.request('GET', f'http://example.com/{path}')
						response = connection.getresponse()
						self.assertEqual(response.status, 403)
						response.read()
						open_upstream.assert_not_called()
				finally:
					connection.close()

	def test_egress_proxy_blocks_private_https_tunnel_before_connecting(self):
		with SERVICE.PublicEgressProxy() as proxy:
			connection = socket.create_connection(('127.0.0.1', proxy.port), timeout=2)
			try:
				with patch.object(SERVICE, 'connect_pinned_address') as open_upstream:
					connection.sendall(
						b'CONNECT 169.254.169.254:443 HTTP/1.1\r\n'
						b'Host: 169.254.169.254:443\r\n\r\n'
					)
					response = connection.recv(4096)
					self.assertIn(b' 403 ', response)
					open_upstream.assert_not_called()
			finally:
				connection.close()

	def test_domain_allowlist_is_restricted_to_the_requested_host_and_port(self):
		self.assertEqual(
			SERVICE.build_allowed_domain_pattern('https://example.com/article', 'example.com'),
			'https://example.com/*',
		)
		self.assertEqual(
			SERVICE.build_allowed_domain_pattern('http://example.com:8080/article', 'example.com'),
			'http://example.com:8080/*',
		)

	def test_browser_action_allowlist_contains_no_interaction_or_filesystem_tools(self):
		self.assertEqual(
			SERVICE.READ_ONLY_ACTIONS,
			{'done', 'find_elements', 'find_text', 'navigate', 'scroll', 'search_page', 'wait'},
		)
		self.assertTrue({
			'click', 'input', 'send_keys', 'upload_file', 'write_file', 'replace_file', 'evaluate', 'select_dropdown',
		}.isdisjoint(SERVICE.READ_ONLY_ACTIONS))

	def test_rejects_unconfigured_or_unknown_ai_providers(self):
		for config in ({}, {'provider': 'unknown'}, {'provider': 'gemini', 'model': '../invalid'}):
			with self.subTest(config=config), self.assertRaises(ValueError):
				SERVICE.build_llm(config)

	def test_health_endpoint_reports_read_only_service_status(self):
		server = SERVICE.ThreadingHTTPServer(('127.0.0.1', 0), SERVICE.Handler)
		thread = threading.Thread(target=server.serve_forever, daemon=True)
		thread.start()
		try:
			connection = HTTPConnection('127.0.0.1', server.server_port, timeout=2)
			connection.request('GET', '/health')
			response = connection.getresponse()
			data = json.loads(response.read())
			self.assertEqual(response.status, 200)
			self.assertEqual(data, {'available': True, 'readOnly': True})
			connection.close()
		finally:
			server.shutdown()
			server.server_close()
			thread.join(timeout=2)

	def test_research_endpoint_rejects_browser_origin_requests(self):
		server = SERVICE.ThreadingHTTPServer(('127.0.0.1', 0), SERVICE.Handler)
		thread = threading.Thread(target=server.serve_forever, daemon=True)
		thread.start()
		try:
			connection = HTTPConnection('127.0.0.1', server.server_port, timeout=2)
			body = json.dumps({'url': 'https://example.com/', 'question': 'Read it'}).encode()
			connection.request(
				'POST',
				'/research',
				body=body,
				headers={'content-type': 'application/json', 'Origin': 'https://untrusted.example'},
			)
			response = connection.getresponse()
			self.assertEqual(response.status, 403)
			self.assertIn('loopback server requests only', response.read().decode())
			connection.close()
		finally:
			server.shutdown()
			server.server_close()
			thread.join(timeout=2)


if __name__ == '__main__':
	unittest.main()
