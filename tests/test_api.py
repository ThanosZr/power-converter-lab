"""Exercise the real HTTP API, including errors and offline front-end assets."""
import json
from threading import Thread
from http.server import ThreadingHTTPServer
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from run import Handler


class HTTPContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def post(self,action,data):
        req=Request(self.url+'/api/'+action,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        with urlopen(req) as r:return json.load(r)

    def test_health_and_assets(self):
        for path in ['/','/app.js','/style.css','/api/health','/api/catalog']:
            with urlopen(self.url+path) as r:
                self.assertEqual(r.status,200)
                self.assertGreater(len(r.read()),20)
                self.assertIn("default-src 'self'",r.headers['Content-Security-Policy'])

    def test_analyze_and_custom_problem(self):
        a=self.post('analyze',{'topology':'flyback','vin':24,'vo':12,'power':24,'L':30e-6})
        self.assertEqual(a['mode'],'BCM')
        b=self.post('sweep',{'axes':[{'field':'vin','min':8,'max':24,'points':11},{'field':'vo','min':8,'max':16,'points':11}]})
        self.assertEqual(len(b['points']),121)
        cap=self.post('capacitance',{'voltage_ripple':.1})
        self.assertGreater(cap['C_required'],0)

    def test_input_errors_are_400(self):
        with self.assertRaises(HTTPError) as exc:
            self.post('analyze',{'topology':'buck','vin':8,'vo':12})
        self.assertEqual(exc.exception.code,400)
        with self.assertRaises(HTTPError) as exc:
            self.post('inverse',{'known':{'vin':'__import__("os").system("false")','vo':12}})
        self.assertEqual(exc.exception.code,400)


if __name__=='__main__':unittest.main(verbosity=2)
