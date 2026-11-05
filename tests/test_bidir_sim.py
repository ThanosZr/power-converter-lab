"""Browser simulator web/sim.js, run under Node (skipped if Node is absent)."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

SIM = Path(__file__).resolve().parents[1] / 'web' / 'bidirectional' / 'sim.js'
RUN = r"""
const {BidirSim}=require(process.argv[1]);const out={};const fs=20e3,T=1/fs,L=5.6e-6;
const per=(s,n)=>{s.run(n*T);return s.last;};
let s=new BidirSim({pos:'above',Vst:100,Vbus:50,L,fs,h:T/1000,control:{mode:'open',D:.5}});s.reset({i0:-800});out.tri=per(s,40);
s=new BidirSim({pos:'above',Vst:100,Vbus:50,L,fs,h:T/1000,carrier:'saw',control:{mode:'open',D:.5}});s.reset({i0:-800-25/(L*fs)/2});out.saw=per(s,40);
s=new BidirSim({pos:'above',Vst:100,Vbus:50,L,fs,h:T/500,control:{mode:'open',D:.5}});s.reset({i0:0});out.zero=per(s,200);
s=new BidirSim({pos:'above',Vst:100,Vbus:50,L,fs,h:T/500,control:{mode:'open',D:.501}});s.reset({i0:-800});const a=per(s,1).iavg;out.drift=(per(s,20).iavg-a)/(20*T);
s=new BidirSim({pos:'above',Vst:100,Vbus:50,L,fs,h:T/500,control:{mode:'pi',Kp:3.4417e-4,Ki:0.45965,ff:true,ref:[{t:0,I:-800},{t:5e-3,I:800}]}});s.reset({i0:0});
out.pi5=per(s,100).iavg;out.pi10=per(s,100).iavg;
s=new BidirSim({pos:'below',Vst:25,Vbus:50,L,fs,h:T/1000,control:{mode:'open',D:.5}});s.reset({i0:1600});out.below=per(s,40);
s=new BidirSim({pos:'above',Vst:100,bus:'system',Vsrc:50,Rsrc:1e-3,C:.1,ESR:2e-4,L,fs,h:T/500,load:{type:'cpl',P:60e3},loadSchedule:[{t:0,P:60e3},{t:5e-3,P:30e3}],
 control:{mode:'pi',Kp:3.4417e-4,Ki:0.45965,ff:true,ref:[{t:0,I:-800}]}});s.reset({i0:-800,vC0:49.596});out.sysBefore=per(s,99);out.sysAfter=per(s,40);
// manual duty: D0+0.02 for 45 periods, then back to D0 -> the new current holds
s=new BidirSim({pos:'above',Vst:100,Vbus:50,L,fs,h:T/500,control:{mode:'open',D:.5}});s.reset({i0:-800});s.run(5*T);s.p.control.D=.52;s.run(45*T);s.p.control.D=.5;out.man1=per(s,5).iavg;out.man2=per(s,50).iavg;
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipIf(shutil.which('node') is None, 'Node.js not installed; the browser runs the same file.')
class Simulator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run(['node', '-e', RUN, str(SIM)], capture_output=True, text=True, timeout=600)
        if run.returncode:
            raise RuntimeError(run.stderr)
        cls.o = json.loads(run.stdout)

    def test_direct_initial_current(self):
        for key in ('tri', 'saw'):
            r = self.o[key]
            self.assertAlmostEqual(r['iavg'], -800, delta=1e-6 * 800)
            self.assertAlmostEqual(r['imax'] - r['imin'], 223.2143, places=3)
            self.assertAlmostEqual(r['pbus'], 40e3, delta=0.1)

    def test_no_convergence_and_drift(self):
        self.assertAlmostEqual(self.o['zero']['iavg'], 0, delta=1e-6)
        self.assertAlmostEqual(self.o['drift'], 100 * 0.001 / 5.6e-6, delta=1)

    def test_pi_and_reversal(self):
        self.assertAlmostEqual(self.o['pi5'], -800, delta=8)
        self.assertAlmostEqual(self.o['pi10'], 800, delta=8)

    def test_manual_duty_reverses_power(self):
        # 45 periods at +0.02: ΔI = 45·T·V_hi·0.02/L = 803.6 A, then D = D0 holds it
        self.assertAlmostEqual(self.o['man1'], -800 + 45 * 100 * 0.02 / (5.6e-6 * 20e3), delta=1)
        self.assertAlmostEqual(self.o['man2'], self.o['man1'], delta=1e-6)

    def test_below_position(self):
        r = self.o['below']
        self.assertAlmostEqual(r['iavg'], 1600, delta=1e-3)
        self.assertAlmostEqual(r['imax'] - r['imin'], 25 * 0.5 / (5.6e-6 * 20e3), places=3)

    def test_system_load_issue(self):
        b, a = self.o['sysBefore'], self.o['sysAfter']
        self.assertAlmostEqual(b['vbus'], (50 + (2500 - 4e-3 * 20e3) ** .5) / 2, delta=0.02)
        self.assertGreater(b['isrc'], 300)
        self.assertEqual(a['isrc'], 0)           # unidirectional source blocks
        self.assertGreater(a['vbus'], 51)        # surplus charges the bus capacitor


if __name__ == '__main__':
    unittest.main(verbosity=2)
