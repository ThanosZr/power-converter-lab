#!/usr/bin/env python3
"""Batch/CLI access to the same engine used by the UI."""
import argparse
import json
from pathlib import Path
from run import ACTIONS
from engine.analysis import InputError

parser=argparse.ArgumentParser(description='Power Converter Lab batch solver')
parser.add_argument('action',choices=sorted(ACTIONS))
parser.add_argument('request',type=Path,help='JSON request, or pcl-project-1 file for analyze')
parser.add_argument('--output',type=Path)
args=parser.parse_args()
try:
    data=json.loads(args.request.read_text(encoding='utf-8'))
    if data.get('schema')=='pcl-project-1':data=data['config']
    result=ACTIONS[args.action](data)
    text=json.dumps(result,ensure_ascii=False,allow_nan=False,indent=2)
    if args.output:args.output.write_text(text,encoding='utf-8')
    else:print(text)
except (InputError,ValueError,OSError,KeyError) as error:
    parser.exit(1,str(error)+'\n')
