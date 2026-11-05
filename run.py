#!/usr/bin/env python3
"""Local-only HTTP application. No account, cloud, CDN, GPU or MATLAB required."""
import argparse
import json
import mimetypes
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore, Timer
import traceback
from urllib.parse import urlsplit
import webbrowser

from engine import __version__
from engine.analysis import steady, inverse, InputError
from engine.models import public_catalog
from engine.dynamics import linearize, switching
from engine.design import envelope, size_components
from engine.workbench import sweep,capacitance
from engine.problem import solve_problem
from engine.circuit import validated,recognize
from engine.curves import operating_curves
from engine.derivation import derive
from engine.proof import model_proof
from engine.boundary import solve_boundary
from engine.bidir import solve as bidir_solve
from engine.studio_math import studio_math
from engine.batch import batch_sim
from engine.templates import template_solve

ROOT=Path(__file__).resolve().parent/'web'
SLOTS=BoundedSemaphore(2)
ACTIONS={'analyze':steady,'inverse':inverse,'linearize':linearize,
         'switching':switching,'envelope':envelope,'design':size_components,
         'sweep':sweep,'capacitance':capacitance,'problem':solve_problem,'curves':operating_curves,
         'derivation':derive,'model_proof':model_proof,'boundary':solve_boundary}
ACTIONS={key:validated(fn) for key,fn in ACTIONS.items()}
ACTIONS['validate_circuit']=recognize
# PE2 bidirectional converter (the /bidirectional/ app calls it as 'solve')
ACTIONS['solve']=bidir_solve
ACTIONS['bidir']=bidir_solve
# studio: analytic bundle from the drawn circuit
ACTIONS['studio_math']=studio_math
# studio: reference run with SciPy solve_ivp on the browser's netlist
ACTIONS['batch_sim']=batch_sim
# solution templates as data (pcl-template-1)
ACTIONS['template_solve']=template_solve


class Handler(BaseHTTPRequestHandler):
    def send(self,status,body,kind='application/json; charset=utf-8'):
        if not isinstance(body,bytes):
            body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/api/health':
            self.send(200,{'ok':True,'version':__version__,'engine':'Python + SymPy + SciPy · browser MNA'})
        elif path=='/api/catalog':
            self.send(200,{'models':public_catalog()})
        else:
            relative=path.lstrip('/')
            if relative=='' or relative.endswith('/'):
                relative+='index.html'
            elif (ROOT/relative).is_dir():
                self.send_response(301);self.send_header('Location',path+'/');self.send_header('Content-Length','0');self.end_headers();return
            file=(ROOT/relative).resolve()
            if not file.is_relative_to(ROOT) or not file.is_file():
                self.send(404,{'error':'Δεν βρέθηκε.'})
                return
            kind=mimetypes.guess_type(file)[0] or 'application/octet-stream'
            self.send(200,file.read_bytes(),kind+'; charset=utf-8' if kind.startswith(('text/','application/javascript')) else kind)

    def do_POST(self):
        action=urlsplit(self.path).path.removeprefix('/api/')
        if action not in ACTIONS:
            self.send(404,{'error':'Άγνωστη ανάλυση.'}); return
        if self.headers.get_content_type()!='application/json':
            self.send(415,{'error':'Απαιτείται application/json.'}); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=400000:
                raise InputError('Μη έγκυρο μέγεθος αιτήματος.')
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):
                raise InputError('Απαιτείται αντικείμενο JSON.')
            if not SLOTS.acquire(blocking=False):
                self.send(429,{'error':'Εκτελούνται ήδη δύο αναλύσεις. Περιμένετε να ολοκληρωθούν.'}); return
            try:
                result=ACTIONS[action](data)
            finally:
                SLOTS.release()
            self.send(200,result)
        except (InputError,ValueError,TypeError,OverflowError,ZeroDivisionError) as e:
            self.send(400,{'error':str(e) or 'Μη έγκυρα δεδομένα.'})
        except Exception:
            traceback.print_exc()
            self.send(500,{'error':'Εσωτερικό σφάλμα. Δείτε το terminal και κρατήστε το αρχείο έργου για αναπαραγωγή.'})


def main():
    parser=argparse.ArgumentParser(description='Power Converter Lab 2')
    parser.add_argument('--port',type=int,default=int(os.environ.get('PORT',8765)))
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--no-browser',action='store_true')
    args=parser.parse_args()
    try:
        server=ThreadingHTTPServer((args.host,args.port),Handler)
    except OSError as exc:
        raise SystemExit(f'Cannot start server: {exc}. Try --port 8766.')
    url=f'http://127.0.0.1:{server.server_port}'
    print(f'Power Converter Lab {__version__} · {url}',flush=True)
    print('Stop: Ctrl+C. Keep this terminal open.',flush=True)
    if not args.no_browser:
        Timer(.8,lambda:webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__=='__main__':
    main()
