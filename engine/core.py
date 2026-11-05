"""Shared helpers: input validation and printable mathematics.

Every equation the GUI shows is a SymPy object rendered to MathML (offline,
no CDN) and LaTeX. Numerical substitutions are built unevaluated, so the
reader sees the actual numbers that were used, not only the result.
"""
import math
import sympy as sp
from sympy import UnevaluatedExpr
from sympy.printing.mathml import MathMLPresentationPrinter


class InputError(ValueError):
    pass


def number(data, key, default=None, low=0.0, high=1e12, strict_low=True):
    raw = data.get(key, default)
    if isinstance(raw, bool) or raw is None:
        raise InputError(f'{key}: απαιτείται αριθμός.')
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise InputError(f'{key}: απαιτείται αριθμός.') from None
    ok = (value > low if strict_low else value >= low) and value <= high
    if not math.isfinite(value) or not ok:
        raise InputError(f'{key}: εκτός επιτρεπτού εύρους ({low}, {high}].')
    return value


class _MathML(MathMLPresentationPrinter):
    """Prints an UnevaluatedExpr as its content (parenthesised only if a sum)."""
    def _print_UnevaluatedExpr(self, expr):
        inner = expr.args[0]
        body = self._print(inner)
        if not isinstance(inner, sp.Add):
            return body
        row = self.dom.createElement('mrow')
        for part in ('(', None, ')'):
            if part is None:
                row.appendChild(body)
            else:
                mo = self.dom.createElement('mo')
                mo.appendChild(self.dom.createTextNode(part))
                row.appendChild(mo)
        return row


def math_record(expr):
    return {'text': str(expr), 'latex': sp.latex(expr, order='none'),
            'mathml': '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">'
                      + _MathML({'order': 'none'}).doprint(expr) + '</math>'}


SUP = str.maketrans('-0123456789', '⁻⁰¹²³⁴⁵⁶⁷⁸⁹')


def n(x, sig=6):
    """A number as a printable SymPy atom: integer, plain decimal, or m·10ᵉ."""
    x = float(x)
    if x == 0:
        return sp.Integer(0)
    if abs(x - round(x)) < 1e-9 * max(1, abs(x)) and abs(x) < 1e7:
        return sp.Integer(int(round(x)))
    if 1e-3 <= abs(x) < 1e6:
        text = f'{x:.{sig}g}'
        return sp.Float(text) if 'e' not in text else sp.Float(x, sig)
    exponent = int(math.floor(math.log10(abs(x))))
    mantissa = float(f'{x / 10 ** exponent:.{min(sig, 5)}g}')
    m = str(int(mantissa)) if mantissa == int(mantissa) else f'{mantissa:g}'
    return sp.Symbol(f'{m}·10{str(exponent).translate(SUP)}')


def held(expr, values):
    """Substitute symbols by numbers without evaluating the arithmetic.

    Builds explicit fractions and subtractions so the substitution reads like
    a hand calculation: 1 − 50/60, not (−1)·50·60⁻¹.
    """
    if expr in values:
        return n(values[expr])
    if expr.is_Atom:
        return expr
    if isinstance(expr, sp.Add):
        terms = []
        for a in expr.args:
            coeff, rest = a.as_coeff_Mul()
            if coeff.is_negative:
                pos = rest if coeff == -1 else sp.Mul(-coeff, rest)
                terms.append(sp.Mul(-1, UnevaluatedExpr(held(pos, values)), evaluate=False))
            else:
                terms.append(held(a, values))
        return sp.Add(*terms, evaluate=False)
    if isinstance(expr, sp.Mul):
        coeff, _ = expr.as_coeff_Mul()
        if coeff.is_negative:
            return sp.Mul(-1, UnevaluatedExpr(held(-expr, values)), evaluate=False)
        num, den = [], []
        for f in expr.args:
            if isinstance(f, sp.Pow) and f.exp.is_negative:
                den.append(held(f.base ** (-f.exp), values))
            else:
                num.append(held(f, values))
        top = num[0] if len(num) == 1 else (sp.Mul(*num, evaluate=False) if num else sp.Integer(1))
        if not den:
            return top
        bottom = den[0] if len(den) == 1 else sp.Mul(*den, evaluate=False)
        return sp.Mul(top, sp.Pow(bottom, -1, evaluate=False), evaluate=False)
    if isinstance(expr, sp.Pow):
        if expr.exp.is_negative:
            return sp.Mul(sp.Integer(1), sp.Pow(held(expr.base ** (-expr.exp), values), -1, evaluate=False), evaluate=False)
        return sp.Pow(held(expr.base, values), expr.exp, evaluate=False)
    try:
        return expr.func(*[held(a, values) for a in expr.args], evaluate=False)
    except TypeError:
        return expr.func(*[held(a, values) for a in expr.args])


def equation(lhs, rhs):
    return math_record(sp.Eq(lhs, rhs, evaluate=False))


def step(title, text, lhs=None, rhs=None, values=None, result=None, unit=''):
    """One derivation step: symbolic relation, substitution and result."""
    out = {'title': title, 'explanation': text}
    if lhs is not None:
        out['math'] = equation(lhs, rhs)
        if values is not None:
            out['numeric'] = equation(lhs, held(rhs, values))
    if result is not None:
        out['result'] = equation(lhs, n(result)) if lhs is not None else None
        out['value'] = float(result)
        out['unit'] = unit
    return out


def note(title, text, expr=None):
    out = {'title': title, 'explanation': text}
    if expr is not None:
        out['math'] = math_record(expr)
    return out
