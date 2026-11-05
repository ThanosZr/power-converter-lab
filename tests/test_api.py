"""Real HTTP server: studio assets, the two analytic apps and their API actions."""
import json
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from run import Handler


class HTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, action, data):
        req = Request(f'{self.url}/api/{action}', data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
        with urlopen(req) as r:
            return json.load(r)

    def test_assets(self):
        for path in ('/', '/studio/app.js', '/studio/mna.js', '/studio/editor.js', '/studio/scope.js', '/studio/tutorials.js',
                     '/studio/parts.js', '/studio/style.css', '/converter/', '/converter/app.js', '/bidirectional/',
                     '/bidirectional/sim.js', '/api/health', '/api/catalog'):
            with urlopen(self.url + path) as r:
                self.assertEqual(r.status, 200, path)

    def test_v1_analysis_for_studio(self):
        r = self.post('analyze', {'topology': 'buck', 'vin': 24, 'fs': 100e3, 'L': 100e-6, 'C': 100e-6,
                                  'drive': 'fixed_duty', 'duty_set': .5, 'resistance': 10})
        self.assertEqual(r['mode'], 'CCM')
        self.assertAlmostEqual(r['config']['vo'], 12)
        self.assertAlmostEqual(r['metrics']['Iripple_pp'], .6)

    def test_bidirectional(self):
        for action in ('bidir', 'solve'):
            r = self.post(action, {'position': 'below'})
            self.assertEqual((r['config']['vst_min'], r['config']['vst_max']), (25, 40))

    def test_errors(self):
        with self.assertRaises(HTTPError) as e:
            self.post('bidir', {'vst_min': 'abc'})
        self.assertEqual(e.exception.code, 400)
        with self.assertRaises(HTTPError) as e:
            self.post('nothing', {})
        self.assertEqual(e.exception.code, 404)


if __name__ == '__main__':
    unittest.main(verbosity=2)
