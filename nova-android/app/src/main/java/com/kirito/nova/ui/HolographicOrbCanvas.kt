package com.kirito.nova.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kirito.nova.data.NovaState
import kotlin.math.PI
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

private data class OrbParticle(
    val origX: Float,
    val origY: Float,
    val origZ: Float,
    val size: Float,
    val colorIndex: Int, // 0: Rojo Eléctrico, 1: Azul Eléctrico Puro, 2: Azul Relámpago
    val pulseOffset: Float
)

private data class ProjectedParticle(
    val x: Float,
    val y: Float,
    val z: Float,
    val scale: Float,
    val alpha: Float,
    val colorIndex: Int,
    val size: Float
)

@Composable
fun HolographicOrbCanvas(
    state: NovaState,
    isAwake: Boolean,
    voiceEnergy: Float,
    onOrbClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val particleCount = 340
    val particles = remember {
        val goldenRatio = (1.0 + sqrt(5.0)) * PI
        List(particleCount) { i ->
            val phi = acos(1.0 - 2.0 * (i + 0.5) / particleCount)
            val theta = goldenRatio * i
            OrbParticle(
                origX = (cos(theta) * sin(phi)).toFloat(),
                origY = (sin(theta) * sin(phi)).toFloat(),
                origZ = cos(phi).toFloat(),
                size = (i % 3) * 0.95f + 1.5f,
                colorIndex = when {
                    i % 3 == 0 -> 0 // Rojo Eléctrico (#FF0033)
                    i % 3 == 1 -> 1 // Azul Eléctrico (#0055FF)
                    else -> 2       // Azul Relámpago (#00C8FF)
                },
                pulseOffset = (i * 0.37f) % (2f * PI.toFloat())
            )
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "orbTime")
    val animPhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = (2f * PI).toFloat() * 20f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 120000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "phase"
    )

    // Paleta Saturada: Rojo Eléctrico, Azul Eléctrico y Negro Abismal
    val crimsonRed = Color(0xFFFF0033)
    val hotRed = Color(0xFFFF2A55)
    val electricBlue = Color(0xFF0055FF)
    val lightningBlue = Color(0xFF00C8FF)

    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val cx = w / 2f
            val cy = h / 2f
            val baseRadius = minOf(w, h) * 0.35f

            val speedMult = when (state) {
                NovaState.IDLE -> if (isAwake) 1.4f else 0.9f
                NovaState.LISTENING -> 1.85f
                NovaState.THINKING -> 3.6f
                NovaState.SPEAKING -> 2.1f
            }

            val t = animPhase * speedMult
            val targetRadius = when (state) {
                NovaState.IDLE -> baseRadius + sin(t * 0.8f) * 5f + (voiceEnergy * 18f)
                NovaState.LISTENING -> baseRadius + 16f + (voiceEnergy * 42f)
                NovaState.THINKING -> baseRadius - 8f + sin(t * 2.5f) * 12f
                NovaState.SPEAKING -> baseRadius + 15f + sin(t * 2.0f) * 18f
            }

            // Resplandor ambiental central saturado
            val auraColor = when (state) {
                NovaState.LISTENING -> crimsonRed.copy(alpha = 0.32f)
                NovaState.THINKING -> lightningBlue.copy(alpha = 0.30f)
                NovaState.SPEAKING -> crimsonRed.copy(alpha = 0.34f)
                NovaState.IDLE -> if (isAwake) crimsonRed.copy(alpha = 0.28f) else electricBlue.copy(alpha = 0.25f)
            }
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(auraColor, electricBlue.copy(alpha = 0.08f), Color.Transparent),
                    center = Offset(cx, cy),
                    radius = baseRadius * 1.5f
                ),
                radius = baseRadius * 1.5f,
                center = Offset(cx, cy)
            )

            val rotX = t * 0.24f
            val rotY = t * 0.38f
            val cosX = cos(rotX)
            val sinX = sin(rotX)
            val cosY = cos(rotY)
            val sinY = sin(rotY)

            val projected = ArrayList<ProjectedParticle>(particleCount)
            for (p in particles) {
                val x1 = p.origX * cosY - p.origZ * sinY
                val z1 = p.origZ * cosY + p.origX * sinY
                val y1 = p.origY * cosX - z1 * sinX
                val z2 = z1 * cosX + p.origY * sinX

                val wave = sin(t * 1.4f + p.pulseOffset) * 0.07f
                val currentR = targetRadius * (1f + wave + if (state == NovaState.LISTENING) voiceEnergy * 0.22f else 0f)
                val perspective = 520f / (520f + z2 * currentR)
                val px = cx + x1 * currentR * perspective
                val py = cy + y1 * currentR * perspective
                val alpha = ((z2 + 1.25f) / 2.25f).coerceIn(0.22f, 1f)

                projected.add(
                    ProjectedParticle(
                        x = px,
                        y = py,
                        z = z2,
                        scale = perspective,
                        alpha = alpha,
                        colorIndex = p.colorIndex,
                        size = p.size
                    )
                )
            }

            projected.sortBy { it.z }

            // Filamentos de energía Rojo / Azul Eléctrico
            for (i in 0 until projected.size step 8) {
                val p1 = projected[i]
                for (j in i + 8 until projected.size step 8) {
                    val p2 = projected[j]
                    val dx = p1.x - p2.x
                    val dy = p1.y - p2.y
                    val distSq = dx * dx + dy * dy
                    if (distSq < 2200f) {
                        val lineAlpha = (0.22f * (1f - sqrt(distSq) / 47f) * p1.alpha).coerceIn(0f, 0.42f)
                        val lineCol = if (state == NovaState.LISTENING || isAwake) crimsonRed else electricBlue
                        drawLine(
                            color = lineCol.copy(alpha = lineAlpha),
                            start = Offset(p1.x, p1.y),
                            end = Offset(p2.x, p2.y),
                            strokeWidth = 1.3f
                        )
                    }
                }
            }

            // Dibujar partículas 3D saturadas
            for (p in projected) {
                val baseCol = when {
                    state == NovaState.LISTENING || isAwake -> if (p.colorIndex == 1) lightningBlue else crimsonRed
                    state == NovaState.THINKING -> if (p.colorIndex == 0) crimsonRed else lightningBlue
                    state == NovaState.SPEAKING -> if (p.colorIndex == 0) hotRed else lightningBlue
                    p.colorIndex == 0 -> crimsonRed
                    p.colorIndex == 1 -> electricBlue
                    else -> lightningBlue
                }

                drawCircle(
                    color = baseCol.copy(alpha = p.alpha),
                    radius = p.size * p.scale * 1.45f,
                    center = Offset(p.x, p.y)
                )
            }
        }

        // Núcleo Interactivo Táctil Central
        val coreBorderColor = when (state) {
            NovaState.LISTENING -> crimsonRed
            NovaState.THINKING -> lightningBlue
            NovaState.SPEAKING -> crimsonRed
            NovaState.IDLE -> if (isAwake) crimsonRed else electricBlue
        }

        Box(
            modifier = Modifier
                .size(68.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            coreBorderColor.copy(alpha = 0.48f),
                            electricBlue.copy(alpha = 0.18f),
                            Color(0xFF020205).copy(alpha = 0.85f)
                        )
                    )
                )
                .border(2.dp, coreBorderColor, CircleShape)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onOrbClick
                ),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = when (state) {
                    NovaState.LISTENING -> "🎙️"
                    NovaState.THINKING -> "⚡"
                    NovaState.SPEAKING -> "🔊"
                    NovaState.IDLE -> if (isAwake) "🎙️" else "⚡"
                },
                fontSize = 22.sp
            )
        }
    }
}
