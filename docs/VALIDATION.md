# Validation — version 1.0

Version 0.3 was validated with Python 3.12, SymPy 1.14.0, NumPy 2.3.5 and SciPy 1.17.0 on Linux.
Version 1.0: all **54 tests pass** on Python 3.13 (Linux). Full test output is in `VALIDATION.log`.
JavaScript passes `node --check`. A 41×41 Vin/Vo sweep also completed with
1,681 valid custom combinations (buck–boost, Vin=8–24 V, Vo=8–16 V).

Coverage includes:

- Buck–boost exam endpoints: 4.8 μH / 10 A peak at 8 V, and 13.333 μH / 6 A
  peak at 24 V, at their respective BCM boundaries.
- Flyback 24→12 V, 24 W, 100 kHz, n=0.5: BCM at Lm=30 μH and Ipk=4 A.
- Buck capacitor ripple and RMS current against independently calculated values.
- Boost interior envelope maximum at Vin=2Vo/3.
- Charge/power balances, nonnegative currents and CCM/DCM continuity in all
  four families, over multiple L/Lcrit ratios.
- Exported waveform numerical integrals versus exact segment RMS integrals.
- Component sizing constraints at independent validation sample points.
- Symbolic buck Gvd against a known expression; all four DC control gains
  against differentiation of the equilibrium gain.
- Right-half-plane zeros, resistive-load stability and constant-power-load
  instability of the CCM averaged models.
- Inverse problems, missing-data reporting, C/frequency/inductance unknowns.
- Fixed-duty/regulated-output round trips in all families and conduction modes.
- Nonunique ideal constant-power DCM/BCM output, including exact energy equality.
- Two-dimensional Vin/Vo and fixed-duty/load sweeps, invalid regions and
  incompatible role selections.
- Capacitor sizing, existing-capacitor ripple and ESR bound failure handling.
- Independent event-driven ODE simulations in CCM and DCM in all families;
  steady output agreement within 1.2% for the selected small-ripple test cases.
- An unregulated load step that changes the steady DCM output.
- Real HTTP health/assets/catalog, analysis/custom actions and error responses.
- Strict JSON serialization, nonfinite/negative inputs and rejection of
  executable-looking text as numeric input.

## Limits of this validation

This is a first validated model baseline, not a certification for hardware
design. ODE agreement was tested for selected points, not every possible
input. Analytical steady-state results use the small-ripple approximation.

Full visual browser QA could not run: the isolated preview runtime lacked the
Python numerical dependencies. The real HTTP application was tested locally
through the API suite, and JavaScript syntax was checked. Browser layout,
Windows installation has not yet been verified. Nonvisual DOM integration with the real HTTP server is covered separately below.

An ODE result only counts as settled when the reported scaled period-to-period
residual is below 1e-4. The default 300 cycles may be insufficient for lightly
damped points. Increase cycles up to 1,000; the application does not label an
unsettled result as steady state.

## Primary technical references

The implementation derives its equations from its declared ideal state
models. References used to cross-check the approach and terminology:

- Texas Instruments, *Understanding Inverting Buck-Boost Power Stages in
  Switch Mode Power Supplies*: https://www.ti.com/lit/an/slva059b/slva059b.pdf
- Texas Instruments, *Designing a DCM flyback converter*:
  https://www.ti.com/document-viewer/lit/html/SSZTCW6/GUID-26366CBC-44CB-4459-8939-706F002AF12A
- SymPy, matrix Jacobians and linear algebra:
  https://docs.sympy.org/latest/modules/matrices/matrices.html
- SciPy, `solve_ivp` event integration:
  https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html

No textbook pages, figures or proprietary solutions are reproduced.


0.1.1 adds regression tests for all-CCM and all-DCM flyback sweeps over the
same Vin/Vo axes; an L sweep crossing DCM/BCM/CCM for every family under
regulated output and fixed-duty R loading; and capacitor-only sweep
invariance of the ideal regime classification. Browser/Windows validation
limits above still apply.


## 0.2 additional validation

- Continuous extrema in two variables and numerical checks of the strict CCM
  and DCM choices over independent validation grids.
- Interior extrema in input voltage (boost) and output voltage (buck).
- Impossible fixed-L BCM requirements, and a genuinely constant BCM boundary
  under fixed duty / R with changing input.
- Whole-field rejection of invalid rectangles, rather than silently ignoring
  infeasible corners.
- C sizing and explicit equations for selected point outputs.
- Connectivity invariance under positions/wire ordering, rejection of missing
  connections and reversed diode, and actual topology overriding a stale card.
- DCM transfer-function DC gains against independent steady-state differences;
  flyback DCM reference pole/gain, and explicit BCM model exclusion.
- Duty curves that match CCM references within CCM and differ in DCM, with
  analytically located boundary duties.

In 0.2/0.3, `UI_VALIDATION.log` recorded a nonvisual DOM integration run of the actual
front-end JavaScript connected to the actual Python HTTP server. It covers
boot, all four GUI templates, flyback DCM, generated curves, goal-based
symbolic solution, selected outputs, DCM Gvd, ODE simulation, disconnected
wire rejection, two-port reconnection and component layout changes. Canvas
rendering, pixel layout, real pointer hardware behavior and Windows install
are not established by that test. An SVG-only inspection is not a substitute
for full visual browser QA.

Additional primary reference for DCM low-frequency transfer models:
https://www.ti.com/lit/an/slva059b/slva059b.pdf (DCM section).
The same formulas are derived independently from the declared averaged
output-current equations in `engine/dynamics.py`.


## 0.3 additional validation

- Flyback current/ripple trace matching the 1.4→2.6 A primary waveform,
  secondary/capacitor current conversion, 10 μC charge and 100 μF target.
- Interior capacitor-current zero that increases charge beyond the ON-only
  shortcut, with known 104.1667 μF requirement.
- Original boost diode waveform (0 A for 7 μs, then 10→0 A in 3 μs):
  Io=1.5 A, Δqpp=10.8375 μC, Cmin=108.375 μF for 0.1 Vpp.
- Independent numerical integration of exported iC/q curves in all four
  families and CCM/DCM, with capacitor sizing checked back through steady.
- Retained numerical substitution arithmetic and strict JSON exports.
- Worst-point C design trace and additional RMS/current output selections.
- Transfer proof stages for CCM/DCM and explicit two-sided BCM treatment.
- Inverse BCM Vin/Vo solving from known L, all physical roots, no-solution
  cases and irrelevant old-mode / capacitor / duty fields.
- Load declaration Po versus R and reverse unknowns L/fs/n/Po/R.

The DOM integration run also tests current-ripple/C targeting, applying a
50 mVpp capacitor choice, retaining that target after recalculation,
BCM inversion while the old ordinary operating point is invalid, and applying
the resulting verified BCM point. Full visual/Windows limits above remain.


## 1.0 — independent check of the ripple equations

Reference: exact periodic steady state of the switched circuit with a
resistive load (matrix exponential per interval, root-found diode turn-off,
Poincaré fixed point). No small-ripple assumption, no shared code with the
engine. Textbook: Mohan-style ΔVo = (1−D)Vo/(8LCfs²) for buck CCM and
Io·D/(fs·C) for the other CCM cases; triangle-above-Io area in DCM.

| Case | Mode | Engine ΔVo,pp | Exact ΔVo,pp | Engine error | Textbook error |
|---|---|---|---|---|---|
| Buck 24→12 V, 24 W, L=100 μH | CCM | 7.5000 mV | 7.5019 mV | −0.03 % | −0.03 % |
| Buck, L=5 μH | DCM | 101.197 mV | 101.422 mV | −0.22 % | −0.22 % |
| Boost 12→40 V, 60 W, L=40 μH | CCM | 105.000 mV | 104.986 mV | +0.01 % | +0.01 % |
| Boost, L=8.4 μH | BCM | 108.375 mV | 108.386 mV | −0.01 % | **−3.12 %** |
| Boost, L=3 μH | DCM | 124.313 mV | 124.320 mV | −0.01 % | −0.01 % |
| Buck–boost 8→12 V, 24 W, L=20 μH | CCM | 120.000 mV | 119.918 mV | +0.07 % | +0.07 % |
| Buck–boost, L=2 μH | DCM | 151.694 mV | 151.711 mV | −0.01 % | −0.01 % |
| Buck–boost 19.2→30 V, 240 W, 1.92 μH, 1406.25 μF | DCM | 40.141 mV | 40.142 mV | 0.00 % | 0.00 % |
| Flyback 24→12 V, n=0.5, Lm=100 μH | CCM | 100.000 mV | 99.916 mV | +0.08 % | +0.08 % |
| Flyback, Lm=40 μH | CCM | 104.167 mV | 104.056 mV | +0.11 % | **−3.90 %** |
| Flyback, Lm=10 μH | DCM | 146.432 mV | 146.453 mV | −0.01 % | −0.01 % |

Peak currents agree within 0.2 %. The engine's residual error is the
small-ripple approximation itself (it grows with ΔV/Vo). The textbook
shortcut Io·D/(fs·C) underestimates whenever the capacitor current changes
sign inside the OFF interval (boost BCM, flyback Lm=40 μH): the engine
handles that interior charge extremum. Lcrit, D (CCM/DCM), δ, Ipk, the
flyback reflections (Vin+Vo/n, Vo+nVin, im/n, Lcrit/n²) and the DCM gains
(including the n-independence of the flyback DCM output) were also checked
by hand against the derivations. Regression tests:
`tests/test_live_sim.py::EngineRippleAgainstExact`.

## 1.0 — live simulator (web/sim.js)

Same exact reference, 11 cases, start from zero and from the operating
point, Δt = T/100 and T/1000. At T/1000 the worst deviation of ⟨vo⟩,
ΔVo,pp and iL,max is 0.0004 %. At T/100 errors stay below 0.05 % except at
the exact BCM point (up to 0.8 %), where the tangential iL=0 event is most
sensitive to the step. Regression test: `tests/test_live_sim.py::LiveSimulator`
(runs the actual browser file under Node; skipped if Node is absent).

## 1.0 — browser UI

Real Chromium (Playwright) against the real Python server, scripts in
`tests/ui/`. Covered: boot and automatic calculation; double-click and
Enter open the inspector; drag does not; apply L → CCM→DCM; capacitor
C = Δq/ΔV for a 50 mV target; switch to fixed duty; topology change;
flyback transformer inspector; simulation at 10×, 1× and 0.01× with T/50,
T/500; Space play/pause; reset from the operating point; preset; loading
an example project; every results tab; narrow (stacked) layout. Zero
console errors. Output in `UI_VALIDATION.log`. Windows installation is
still not verified.
