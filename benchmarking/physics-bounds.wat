;; Float64 SIMD bound reduction used only by physics-bounds-kernels.mjs.
;; Inputs are finite, prepacked x/y pairs. The return value is a checksum.
(module
(memory (export "memory") 1)
(func (export "bounds") (param $p i32) (param $n i32) (param $c f64) (param $s f64) (param $x f64) (param $y f64) (result f64)
(local $min v128) (local $max v128) (local $v v128) (local $q v128) (local $r v128) (local $pos v128)
(local.set $min (v128.const f64x2 inf inf))
(local.set $max (v128.const f64x2 -inf -inf))
(local.set $q (f64x2.splat (local.get $c)))
(local.set $r (f64x2.replace_lane 1 (f64x2.splat (f64.neg (local.get $s))) (local.get $s)))
(local.set $pos (f64x2.replace_lane 1 (f64x2.splat (local.get $x)) (local.get $y)))
(loop $loop
(local.set $v (v128.load (local.get $p)))
(local.set $v (f64x2.add (f64x2.add (f64x2.mul (local.get $v) (local.get $q))
(f64x2.mul (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7 (local.get $v) (local.get $v)) (local.get $r))) (local.get $pos)))
(local.set $min (f64x2.min (local.get $min) (local.get $v)))
(local.set $max (f64x2.max (local.get $max) (local.get $v)))
(local.set $p (i32.add (local.get $p) (i32.const 16)))
(local.set $n (i32.sub (local.get $n) (i32.const 1)))
(br_if $loop (local.get $n)))
(f64.add (f64.add (f64x2.extract_lane 0 (local.get $min)) (f64x2.extract_lane 0 (local.get $max)))
(f64.add (f64x2.extract_lane 1 (local.get $min)) (f64x2.extract_lane 1 (local.get $max))))))
