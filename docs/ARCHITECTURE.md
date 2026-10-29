# Engine architecture and extension plan

The 0.3 engine handles registered ideal converter families. It is not yet a
general MNA/netlist solver. The same engine is accessible through the browser,
HTTP, CLI and Python imports. The UI does not recompute electrical formulas.

## Modules

| Module | Responsibility |
|---|---|
| `engine/models.py` | Symbolic interval vector fields, topology registry, averaging, equilibrium, Jacobians and transfer functions |
| `engine/analysis.py` | Input validation, duty/output resolution, regime selection, triangular steady-state currents, exact ramp integrals, charge ripple, symbolic inverse relations, explanation records |
| `engine/dynamics.py` | CCM linearization evaluation and independent event-driven switching ODE integration |
| `engine/design.py` | Symbolic stationary-point search for Lcrit across input voltage and ideal L/C sizing |
| `engine/problem.py` | Goal-driven L/C design, continuous-domain extrema, feasibility and selected-output equations |
| `engine/circuit.py` | Typed connectivity validation and recognition; wraps all HTTP/CLI analysis actions |
| `engine/curves.py` | Duty-to-output characteristics with actual conduction branch and symbolic boundaries |
| `web/editor.js` | Electrical graph, component positions, wiring, rotation, undo and project export |
| `engine/workbench.py` | Custom one/two-axis problems, Cartesian sweeps, invalid-case reporting and capacitor/ESR sizing |
| `run.py` | Local HTTP/static server; fixed API actions, no user-code evaluation |
| `solve.py` | CLI adapter for automation/scripts |
| `web/` | UI, SVG reference circuits, MathML, Canvas plots, SVG operating maps and exports |
| `tests/` | Physical reference cases, regime continuity, inverse problems, independent ODE comparison and real HTTP tests |

Python requirements are deliberately small. A browser and a CPU are enough.
All dimensional inputs at the API boundary use SI units. The UI converts
kHz, μH and μF before requests, and converts them back for display.

## Shared mathematical pipeline

1. Define states x = [iL, vo], with the flyback current referred to primary.
2. Define fON and fOFF from the physical current paths and load law.
3. Form f = D fON + (1−D) fOFF.
4. Solve f=0 symbolically for CCM equilibrium.
5. Derive Lcrit from Iavg=ΔI/2.
6. Solve steady duty/output and select CCM, BCM or DCM.
7. In DCM, use the triangular current transfer and a third idle interval.
8. Integrate segment currents for mean/RMS values and charge extrema.
9. For strict CCM, derive A=∂f/∂x and Bd=∂f/∂D, then
   Gvd=[0 1](sI−A)⁻¹Bd. The matrices and transfer expression come from SymPy.
10. Independently integrate physical switched ODEs with SciPy, using a
    current-zero event to turn off the diode. Compare to the analytical point.

DCM uses a separate one-state low-frequency averaged-current model; BCM is a nonsmooth boundary and does not receive one imposed transfer model. Triangular
steady-state waveforms assume small output ripple; the ODE integrator does not.
The integrator starts near the estimated operating point and reports its
actual period-to-period residual. It is not a startup/controller simulation.

For buck–boost the output state v is the positive magnitude of the negative
terminal voltage. Gvd is the response of that magnitude. For flyback,
n=Ns/Np and L=Lm primary. Winding current is not identical to the continuous
primary-referred magnetizing-current state.

## Problem specification and roles

`drive=regulated`: Vin, Vo and Po specify requested operating conditions.
Duty is solved separately at each point. R=Vo²/Po is an equivalent point
resistance unless the selected load law is constant power.

`drive=fixed_duty, load=resistive`: Vin, D and R are inputs. Vo and Po are
outputs. DCM output is solved with the actual duty, rather than using the
CCM gain outside its domain.

`drive=fixed_duty, load=constant_power`: Po is independent. In ideal
buck–boost/flyback DCM, transferred power is Vin²D²/(2Lf), independent of Vo.
An equality leaves a continuum of BCM/DCM voltages; a mismatch below the
CCM branch has no periodic energy equilibrium. The engine rejects an
invented unique output, including exact BCM energy equality.

The inverse endpoint exposes a finite registry of physical relationships.
It returns symbolic parameter dependencies when information is missing,
and filters positive numerical roots and duty-domain violations.
`boundary_operating` and `current_ripple_ccm` substitute the symbolic
CCM/BCM gain relationship, allowing combinations of Vin/Vo instead of
requiring a separately supplied duty.

An arbitrary text equation, executable script, or arbitrary topology is not
accepted by 0.1. A broader multi-equation problem graph should precede any
natural-language exercise solver.

## Numerical versus continuous-domain claims

The one-axis regulated-input Lcrit search uses endpoints **and all real
interior stationary points** of the symbolic function. The boost maximum at
Vin=2Vo/3 is an explicit regression test.

The custom operating map is a finite grid, up to 41×41 points. Its maxima
and capacitor choice concern those sampled points. Invalid combinations
are returned with reasons. A future robust multi-dimensional optimizer
must not describe a sampled maximum as a continuous-domain proof.

The ideal component-sizing endpoint searches Lcrit and the CCM current
ripple requirement symbolically. For capacitor charge ripple it uses 121
samples plus bounded refinement of detected local maxima. ESR ripple is
an optional conservative post-processing bound, not an ESR dynamic model.

## HTTP / CLI

Every action uses `POST /api/<action>` with an `application/json` object.
Actions: `analyze`, `inverse`, `linearize`, `switching`, `envelope`, `design`,
`sweep`, `capacitance`, `problem`, `curves`, `validate_circuit`. Health/catalog use GET. Invalid data returns HTTP 400.

The local server binds to 127.0.0.1 by default. It serves only `web/`, limits
request size and simultaneous calculations, and accepts only registered
actions. It does not use `eval`, execute uploaded scripts or expose file writes.

Example CLI:

```bash
python solve.py analyze examples/buck_boost_project.json --output result.json
python solve.py sweep examples/custom_vin_vo_sweep.json --output sweep.json
python solve.py inverse examples/solve_capacitor.json
```

Example import:

```python
from engine.analysis import steady

result = steady({
    "topology": "flyback", "vin": 24, "vo": 12, "power": 24,
    "fs": 100_000, "L": 30e-6, "C": 100e-6, "n": 0.5,
})
print(result["mode"], result["metrics"]["Ipeak"])
```

## 0.2: goal-driven solution

The Problem Composer selects the target, operating field and condition.
For inductance, `problem` eliminates duty/load point variables, substitutes
knowns and finds extrema of the critical-inductance function. It enumerates
corners, stationary points on every edge and stationary interior points in a
one/two-dimensional rectangle. Every candidate is independently checked by
running the steady solver with L=Lcrit and verifying BCM.

For strict CCM throughout the field, L must exceed the maximum Lcrit. For
strict DCM it must be below the minimum. These are infimum/supremum bounds,
not attained minima/maxima of the strict sets. `boundary_all` explicitly
checks whether Lcrit is constant before proposing one fixed BCM inductance.
The C goal integrates charge exactly within each ideal point model, while
multi-parameter maximization remains a stated finite-grid calculation.

## 0.2: electrical editor and recognition

The project format optionally stores `circuit.components` and `circuit.wires`.
Components have id/type/x/y/rotation; wires connect `id:port` strings. Position
and rotation are presentation data. Connectivity is the electrical input.

The backend validates pin names, disconnected terminals, supported component
counts and polarity. Union-find builds electrical nodes. Node-equivalence
partitions are matched against the four typed family graphs, allowing harmless
reversal of symmetric elements. Source, capacitor, diode and transformer dot
references remain meaningful. A recognized graph overrides a stale topology
card selection. An unsupported graph fails before any family equations run.
This is family recognition, not automatic MNA/DAE generation for arbitrary
circuits. One component per family role is currently supported.

The UI invalidates previous results on parameter/connectivity edits. They
remain visible but inert and faded until recalculation. Moving a component
preserves electrical results and connections. Graph data is saved with the
project. The two main simulated state variables remain those of the recognized
family; adding a new component does not silently create a new physical model.

## 0.2: DCM dynamics

The inductor current resets within each cycle. Eliminate that fast state and
average the current delivered to the output. In positive output magnitudes:

- Buck: j = Vin(Vin−Vo)D²/(2LfsVo).
- Boost: j = Vin²D²/(2Lfs(Vo−Vin)).
- Buck–boost/flyback: j = Vin²D²/(2LfsVo).

Then C dVo/dt = j−iLoad. Differentiate symbolically with respect to Vo, D and
Vin to produce a first-order low-frequency Gvd/Gvg. For resistive ideal
buck–boost/flyback the pole is −2/(RC) and DC duty gain is Vo/D. Tests compare
DC gains with numerical differentiation of independent fixed-duty steady
solutions. CPL may yield a neutral pole and a nonisolated equilibrium.
This approximation does not model subcycle sampling effects or BCM crossing.

## Updated extension priorities

Visual browser/Windows validation and packaging remain first. Further work:
arbitrary multi-equation problem graphs, transient startup/controllers,
nonideal elements, additional registered families, generic MNA/DAE and
continuous-domain constrained optimization using validated component models.
Every additional topology needs interval fields, steady/regime rules, current
routing, stress equations, independent ODE equations, connectivity recognition
and known-answer/transition tests before being exposed in the GUI.


## 0.3: explanation trace and inverse boundary design

`engine/derivation.py` exposes the complete current/charge/ripple trace from
the exact same interval endpoints as the plotted ideal model. It presents
generic SI equations, numerical piecewise currents in μs, charge in μC,
all charge extrema, exact per-segment RMS integrals, held numerical
substitution arithmetic and the final ripple / C inequality.

`engine/proof.py` generates interval KVL/KCL, averaging, equilibrium,
duty isolation, Jacobians, Laplace matrix, characteristic determinant and
Gvd/Gvg output selection. DCM equations originate in triangular current
areas. BCM retains explicit neighboring models rather than one forced Gvd.

`engine/boundary.py` treats the requested condition separately from the old
operating point: remove old duty, eliminate duty at BCM, substitute knowns,
form an exact rational polynomial in the selected unknown and isolate every
real root. It filters sign/domain/denominator violations and verifies each
remaining point as BCM through the steady solver. The GUI keeps this tool
outside the stale ordinary-result container so that it can solve a new
boundary even if the old point is invalid. Numeric input fingerprints
invalidate stale inverse results. Po/R load declarations are explicit.

New HTTP/CLI actions: `derivation`, `model_proof`, `boundary`.


## 1.0: front end without a parameter sidebar, live simulation

- `web/app.js` keeps all knowns in `state.params` (SI). They are edited in
  a per-component inspector (double-click / Enter / spec chip). Every change
  schedules one recalculation; requests to the engine are serialized, and
  stale renders are dropped with a token, so fast edits never interleave.
- `web/editor.js` no longer rebuilds the SVG for ON/OFF/IDLE highlighting
  or live values: conduction state is an SVG class plus per-part
  `data-on/off/idle` attributes, and live labels are text-node updates.
  Double-click detection is done in the editor (two taps on the same part),
  because a re-render between the clicks would otherwise lose the native
  `dblclick` target.
- `web/sim.js` (`SwitchedSim`) integrates the same interval equations as
  `engine/models.py` in the browser: RK4 with a user step, exact splitting at
  DT and T and at the iL=0 event, unidirectional switch/diode, resistive or
  constant-power load (resistive below 30 % of Vo for start-up). Playback
  speed is measured in switching periods per second (1× = 100 T/s); a step
  debt keeps the chosen Δt exact in slow motion. Samples go to a ring
  buffer (2¹⁹ points) and per-period statistics feed the comparison table
  and the envelope view. The file is also importable from Node for tests.
