"""Solution templates as data ("pcl-template-1").

A template describes an exercise or a design procedure without code:

    inputs    named quantities with a default value and unit; the client may
              bind them to the circuit (comp.<id>.<param>), to a tutorial's
              operating point (meta.<key>) or let the user edit them
    steps     ordered relations  symbol = expression,  each with a title and an
              explanation; an optional "when" condition selects the relation
              for the operating region (e.g. storage above / below the bus)
    cases     a table that re-evaluates the steps for several input sets
    checks    acceptance conditions (relations) with a pass / fail text
    sections  what to show and in which order: text, steps, tables, checks,
              key values, settings (e.g. PLECS) and copyable scripts

The server evaluates everything with SymPy and returns each step as symbolic
relation, substitution and result (MathML), exactly like the built-in engines.
Expressions are parsed from a restricted grammar: names of inputs/steps,
numbers, + - * / ** ( ) , comparisons and a fixed set of functions.
"""
import math
import re

import sympy as sp
from sympy.parsing.sympy_parser import parse_expr, standard_transformations

from .core import step as cstep, InputError

SCHEMA = 'pcl-template-1'
FUNCS = {'sqrt': sp.sqrt, 'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'asin': sp.asin, 'acos': sp.acos,
         'atan': sp.atan, 'atan2': sp.atan2, 'exp': sp.exp, 'log': sp.log, 'log10': lambda x: sp.log(x, 10),
         'abs': sp.Abs, 'Abs': sp.Abs, 'min': sp.Min, 'max': sp.Max, 'Min': sp.Min, 'Max': sp.Max,
         'floor': sp.floor, 'ceiling': sp.ceiling, 'sign': sp.sign, 'pi': sp.pi}
# what the parser's generated code may call (with evaluate=False it builds Add/Mul/Pow/relations)
SAFE = {'Integer': sp.Integer, 'Float': sp.Float, 'Symbol': sp.Symbol, 'Rational': sp.Rational, 'Add': sp.Add, 'Mul': sp.Mul,
        'Pow': sp.Pow, 'Lt': sp.Lt, 'Le': sp.Le, 'Gt': sp.Gt, 'Ge': sp.Ge, 'Eq': sp.Eq, 'Ne': sp.Ne,
        'StrictLessThan': sp.StrictLessThan, 'LessThan': sp.LessThan, 'StrictGreaterThan': sp.StrictGreaterThan,
        'GreaterThan': sp.GreaterThan, 'Unequality': sp.Unequality, 'Equality': sp.Equality}
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,31}$')
TOKEN = re.compile(r'\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|(\*\*|<=|>=|==|!=|[-+*/(),<>]))')
LIMITS = {'inputs': 80, 'steps': 200, 'sections': 30, 'blocks': 200, 'cases': 60, 'expr': 500, 'text': 6000}
PFX = [(1e9, 'G'), (1e6, 'M'), (1e3, 'k'), (1, ''), (1e-3, 'm'), (1e-6, 'μ'), (1e-9, 'n'), (1e-12, 'p')]


def eng(v, unit='', d=4, dec=','):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return str(v)
    if not math.isfinite(v):
        return '—'
    if abs(v) < 1e-13:
        return '0' + (' ' + unit if unit else '')
    for k, p in PFX:
        if abs(v) >= k * .9995:
            s = f'{v / k:.{d}g}'.replace('.', dec)
            return s + (' ' + p + unit if unit or p else '')
    return f'{v:.3e} {unit}'.strip()


def _check_expr(text, names):
    if not isinstance(text, str) or not text.strip() or len(text) > LIMITS['expr']:
        raise InputError('Κενή ή πολύ μεγάλη έκφραση.')
    pos = 0
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m or m.end() == pos:
            if text[pos:].strip() == '':
                break
            raise InputError(f'Μη επιτρεπτό σύμβολο στην έκφραση «{text}» (θέση {pos + 1}).')
        word = m.group(2)
        if word and word not in names and word not in FUNCS:
            raise InputError(f'Άγνωστο όνομα «{word}» στην έκφραση «{text}».')
        pos = m.end()


class Evaluator:
    def __init__(self, tpl, values):
        self.tpl = tpl
        self.symbols = {}
        self.values = {}
        self.units = {}
        self.labels = {}
        for inp in tpl.get('inputs', []):
            name = inp.get('name')
            if not isinstance(name, str) or not NAME.match(name) or name in FUNCS:
                raise InputError(f'Μη έγκυρο όνομα εισόδου: {name!r}')
            v = values.get(name, inp.get('value'))
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise InputError(f'Η είσοδος {name} δεν έχει αριθμητική τιμή.')
            if not math.isfinite(v):
                raise InputError(f'Η είσοδος {name} δεν είναι πεπερασμένη.')
            self.symbols[name] = sp.Symbol(inp.get('symbol') or name)
            self.values[name] = v
            self.units[name] = inp.get('unit', '')
            self.labels[name] = inp.get('label', name)
        self.step_names = [s.get('id') for s in tpl.get('steps', [])]
        for sid in self.step_names:
            if not isinstance(sid, str) or not NAME.match(sid) or sid in FUNCS:
                raise InputError(f'Μη έγκυρο όνομα βήματος: {sid!r}')

    def names(self):
        return set(self.symbols) | set(self.step_names)

    def parse(self, text):
        _check_expr(text, self.names())
        local = {**FUNCS, **{k: sp.Symbol(k) for k in self.names()}}
        expr = parse_expr(text.replace('^', '**'), local_dict=local,
                          global_dict={'__builtins__': {}, **SAFE},
                          transformations=standard_transformations, evaluate=False)
        # display names (e.g. D_0, Delta_i_L) instead of the plain identifiers
        return expr.xreplace({sp.Symbol(k): s for k, s in self.symbols.items() if s.name != k})

    def num(self, expr):
        if isinstance(expr, sp.logic.boolalg.BooleanAtom):
            return bool(expr)
        if isinstance(expr, sp.core.relational.Relational):
            a, b = self.num(expr.lhs), self.num(expr.rhs)
            return {'<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b, '==': abs(a - b) <= 1e-12 * max(1, abs(a), abs(b)),
                    '!=': abs(a - b) > 1e-12 * max(1, abs(a), abs(b))}[expr.rel_op]
        sub = {s: self.values[k] for k, s in self.symbols.items() if k in self.values}
        val = sp.N(expr.xreplace(sub))
        try:
            return float(val)
        except TypeError:
            raise InputError(f'Η έκφραση {expr} δεν δίνει αριθμό (λείπουν τιμές;).')

    def truth(self, text):
        if not text:
            return True
        r = self.num(self.parse(text))
        return bool(r)

    def run_steps(self, symbolic=True):
        out = {}
        for s in self.tpl.get('steps', []):
            sid = s['id']
            if not self.truth(s.get('when')):
                continue
            rhs = self.parse(s['expr'])
            val = self.num(rhs)
            if isinstance(val, bool):
                raise InputError(f'Το βήμα {sid} δίνει λογική τιμή, όχι αριθμό.')
            sym = sp.Symbol(s.get('symbol') or sid)
            vals = {self.symbols[k]: v for k, v in self.values.items()}
            self.symbols[sid] = sym
            self.values[sid] = val
            self.units[sid] = s.get('unit', '')
            self.labels[sid] = s.get('title', sid)
            if symbolic:
                rec = cstep(self.fill(s.get('title', sid)), self.fill(s.get('explain', '')), sym, rhs, vals, val, s.get('unit', ''))
                rec['id'] = sid
                out[sid] = rec
        return out

    # "{expr}", "{expr|unit}" (engineering notation) or "{expr:.4g}" inside texts
    def fill(self, text, dec=','):
        if not isinstance(text, str):
            return ''
        if len(text) > LIMITS['text']:
            raise InputError('Πολύ μεγάλο κείμενο στο template.')

        def rep(m):
            body = m.group(1)
            unit, spec = None, None
            if '|' in body:
                body, unit = body.split('|', 1)
            elif ':' in body:
                body, spec = body.rsplit(':', 1)
            try:
                v = self.num(self.parse(body))
            except InputError:
                return '{' + m.group(1) + '}'
            if isinstance(v, bool):
                return 'ναι' if v else 'όχι'
            if spec:
                try:
                    return format(v, spec).replace('.', dec)
                except ValueError:
                    pass
            if unit is None:
                name = body.strip()
                unit = self.units.get(name, '')
            return eng(v, unit.strip(), dec=dec)
        return re.sub(r'\{([^{}]{1,200})\}', rep, text)


def _case_rows(tpl, base_values, table):
    rows = []
    cols = table.get('columns', [])
    for case in table.get('vary', [])[:LIMITS['cases']]:
        vals = {**base_values, **{k: v for k, v in case.items() if k != 'label'}}
        ev = Evaluator(tpl, vals)
        ev.run_steps(symbolic=False)
        row = [str(case.get('label', ''))]
        for c in cols:
            name, unit = (c, None) if isinstance(c, str) else (c[0], c[1] if len(c) > 1 else None)
            v = ev.values.get(name)
            if v is None:
                try:
                    v = ev.num(ev.parse(name))
                except InputError:
                    v = None
            row.append('—' if v is None else eng(v, ev.units.get(name, '') if unit is None else unit))
        rows.append(row)
    head = [table.get('label_head', '')] + [c if isinstance(c, str) else (c[2] if len(c) > 2 else c[0]) for c in cols]
    return head, rows


def template_solve(data):
    """Action 'template_solve': {template, values} -> sections with evaluated blocks."""
    tpl = data.get('template') if isinstance(data, dict) else None
    if not isinstance(tpl, dict) or tpl.get('schema') != SCHEMA:
        raise InputError(f'Το template πρέπει να έχει schema «{SCHEMA}».')
    for key, lim in (('inputs', 'inputs'), ('steps', 'steps'), ('sections', 'sections')):
        if not isinstance(tpl.get(key, []), list) or len(tpl.get(key, [])) > LIMITS[lim]:
            raise InputError(f'Μη έγκυρο ή πολύ μεγάλο πεδίο «{key}».')
    values = data.get('values') or {}
    if not isinstance(values, dict):
        raise InputError('Οι τιμές πρέπει να είναι αντικείμενο.')
    base = {}
    for k, v in values.items():
        try:
            base[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    ev = Evaluator(tpl, base)
    steps = ev.run_steps(symbolic=True)
    tables = tpl.get('tables', {}) if isinstance(tpl.get('tables', {}), dict) else {}
    checks = []
    for c in tpl.get('checks', []):
        if not ev.truth(c.get('when')):
            continue
        ok = ev.truth(c['expr'])
        checks.append({'title': ev.fill(c.get('title', c['expr'])), 'ok': ok,
                       'text': ev.fill(c.get('pass' if ok else 'fail', ''))})
    sections = []
    nblocks = 0
    for sec in tpl.get('sections', []):
        if not ev.truth(sec.get('when')):
            continue
        blocks = []
        for b in sec.get('blocks', []):
            nblocks += 1
            if nblocks > LIMITS['blocks']:
                raise InputError('Πάρα πολλά blocks στο template.')
            if not ev.truth(b.get('when')):
                continue
            kind = b.get('type')
            if kind == 'text':
                blocks.append({'type': 'text', 'text': ev.fill(b.get('text', ''))})
            elif kind == 'steps':
                blocks.append({'type': 'steps', 'steps': [steps[i] for i in b.get('steps', []) if i in steps]})
            elif kind == 'kv':
                blocks.append({'type': 'kv', 'rows': [[ev.fill(a), ev.fill(v)] for a, v in b.get('rows', [])]})
            elif kind == 'table':
                t = tables.get(b.get('table'))
                if t:
                    head, rows = _case_rows(tpl, base, t)
                    blocks.append({'type': 'table', 'title': ev.fill(t.get('title', '')), 'head': head, 'rows': rows})
            elif kind == 'checks':
                blocks.append({'type': 'checks', 'items': checks})
            elif kind == 'settings':
                blocks.append({'type': 'settings', 'title': ev.fill(b.get('title', '')),
                               'rows': [[ev.fill(a), ev.fill(v)] for a, v in b.get('rows', [])]})
            elif kind == 'script':
                blocks.append({'type': 'script', 'title': ev.fill(b.get('title', '')), 'text': ev.fill(b.get('text', ''), dec='.')})
        sections.append({'id': sec.get('id') or f's{len(sections)}', 'title': ev.fill(sec.get('title', '')), 'blocks': blocks})
    return {'id': tpl.get('id'), 'title': ev.fill(tpl.get('title', '')), 'description': ev.fill(tpl.get('description', '')),
            'inputs': [{'name': i['name'], 'label': i.get('label', i['name']), 'unit': i.get('unit', ''),
                        'value': ev.values[i['name']], 'from': i.get('from'), 'editable': i.get('editable', True)}
                       for i in tpl.get('inputs', [])],
            'values': {k: v for k, v in ev.values.items()},
            'checks': checks, 'sections': sections}
