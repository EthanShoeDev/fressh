// JNI bridge: HybridTerminal.kt <-> the Rust render C-ABI (fressh-render's
// android module). Turns a Java `Surface` into an `ANativeWindow*` and forwards
// create/draw/destroy. See docs §10 (render plane).

#include <android/native_window_jni.h>
#include <jni.h>

// Rust C-ABI (packages/react-native-terminal/rust/fressh-render/src/android.rs).
extern "C" {
void *fressh_terminal_create(void *window, const char *font_path);
void fressh_terminal_draw(void *handle);
void fressh_terminal_destroy(void *handle);
}

// We track the ANativeWindow alongside the Rust handle so we can release the
// window reference (taken by ANativeWindow_fromSurface) on teardown.
namespace {
struct TerminalHandle {
  ANativeWindow *window;
  void *rust;
};
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeCreate(
    JNIEnv *env, jobject /* this */, jobject surface, jstring font_path) {
  ANativeWindow *window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) {
    return 0;
  }

  const char *path = env->GetStringUTFChars(font_path, nullptr);
  void *rust = fressh_terminal_create(window, path);
  env->ReleaseStringUTFChars(font_path, path);

  if (rust == nullptr) {
    ANativeWindow_release(window);
    return 0;
  }

  auto *handle = new TerminalHandle{window, rust};
  return reinterpret_cast<jlong>(handle);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeDraw(
    JNIEnv * /* env */, jobject /* this */, jlong handle) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h != nullptr) {
    fressh_terminal_draw(h->rust);
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeDestroy(
    JNIEnv * /* env */, jobject /* this */, jlong handle) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h != nullptr) {
    fressh_terminal_destroy(h->rust);
    ANativeWindow_release(h->window);
    delete h;
  }
}
