package ai.shittimchest.android.ui

import androidx.compose.runtime.Composable
import ai.shittimchest.android.MainViewModel
import ai.shittimchest.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
