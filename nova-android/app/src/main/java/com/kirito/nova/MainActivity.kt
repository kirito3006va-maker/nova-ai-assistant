package com.kirito.nova

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import com.kirito.nova.data.NovaGatewayController
import com.kirito.nova.theme.NOVAControlTheme
import com.kirito.nova.ui.NovaMainScreen

class MainActivity : ComponentActivity() {

    private lateinit var controller: NovaGatewayController

    private val requestMicPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        controller.onMicPermissionResult(isGranted)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        controller = NovaGatewayController(applicationContext)

        checkAndRequestMicPermission()

        enableEdgeToEdge()
        setContent {
            NOVAControlTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF05050B)
                ) {
                    NovaMainScreen(
                        controller = controller,
                        onRequestMicPermission = { checkAndRequestMicPermission() }
                    )
                }
            }
        }
    }

    private fun checkAndRequestMicPermission() {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (granted) {
            controller.onMicPermissionResult(true)
        } else {
            requestMicPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    override fun onDestroy() {
        if (::controller.isInitialized) {
            controller.destroy()
        }
        super.onDestroy()
    }
}
