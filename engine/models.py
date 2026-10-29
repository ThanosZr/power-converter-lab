"""One source of truth for interval dynamics and symbolic averaged models.

All output voltages are magnitudes. Buck-boost has signed output -v.
Flyback n = Ns/Np, L = primary-referred magnetizing inductance,
i = primary-referred magnetizing current (not continuous winding current).
"""
from dataclasses import dataclass
from functools import lru_cache
import sympy as sp

VIN, V, I, D, L, C, R, N, FS, P, S = sp.symbols(
    "V_in V_o I D L C R n f_s P_o s", positive=True)
X = sp.Matrix([I, V])


@dataclass(frozen=True)
class Model:
    key: str
    name: str
    description: str
    polarity: int = 1

    def fields(self, load="resistive"):
        io = V/R if load == "resistive" else P/V
        if self.key == "buck":
            on, off = [(VIN-V)/L, (I-io)/C], [-V/L, (I-io)/C]
        elif self.key == "boost":
            on, off = [VIN/L, -io/C], [(VIN-V)/L, (I-io)/C]
        elif self.key == "buck_boost":
            on, off = [VIN/L, -io/C], [-V/L, (I-io)/C]
        else:
            on, off = [VIN/L, -io/C], [-V/(N*L), (I/N-io)/C]
        return sp.Matrix(on), sp.Matrix(off)

    def ccm_gain(self):
        # Derive equilibrium from the two averaged state derivatives.
        on, off = self.fields()
        eq = sp.solve(D*on+(1-D)*off, [I, V], dict=True)[0]
        return sp.factor(eq[V]/VIN), sp.factor(eq[I])

    def critical(self):
        gain, mean = self.ccm_gain()
        v = gain*VIN
        slope = (VIN-v)/L if self.key == "buck" else VIN/L
        ripple = slope*D/FS
        boundary = sp.solve(sp.Eq(mean.subs(V, v), ripple/2), L)[0]
        return sp.factor(boundary)


MODELS = {
    "buck": Model("buck", "Buck", "Υποβιβασμός τάσης"),
    "boost": Model("boost", "Boost", "Ανύψωση τάσης"),
    "buck_boost": Model("buck_boost", "Buck–boost", "Αντιστρέφων υποβιβασμός / ανύψωση", -1),
    "flyback": Model("flyback", "Flyback", "Απομονωμένος μετατροπέας · n = Ns/Np"),
}


@lru_cache(maxsize=16)
def symbolic_model(key, load="resistive"):
    model = MODELS[key]
    on, off = model.fields(load)
    avg = D*on + (1-D)*off
    gain, mean = model.ccm_gain()
    duty = sp.solve(sp.Eq(V, gain*VIN), D)[0]
    equilibrium = {V: gain*VIN, I: mean.subs(V, gain*VIN)}
    if load == "constant_power":
        equilibrium[I] = equilibrium[I].subs(R, (gain*VIN)**2/P)
    a = sp.simplify(avg.jacobian(X).subs(equilibrium))
    bd = sp.simplify(avg.diff(D).subs(equilibrium))
    bg = sp.simplify(avg.diff(VIN).subs(equilibrium))
    selector = sp.Matrix([[0, 1]])
    resolvent = S*sp.eye(2)-a
    gd = sp.factor((selector*resolvent.inv()*bd)[0])
    gg = sp.factor((selector*resolvent.inv()*bg)[0])
    return {"on": on, "off": off, "average": avg, "A": a, "Bd": bd,
            "Bg": bg, "Gvd": gd, "Gvg": gg, "gain": gain, "duty": duty,
            "critical": model.critical(), "equilibrium": equilibrium}


def public_catalog():
    return [{"key": m.key, "name": m.name, "description": m.description,
             "polarity": m.polarity, "capabilities": ["steady", "CCM", "DCM", "BCM",
             "inverse_ccm", "linearization_ccm", "linearization_dcm_low_frequency",
             "switching", "envelope", "design", "goal_design", "curves", "recognized_circuit_graph"]}
            for m in MODELS.values()]
