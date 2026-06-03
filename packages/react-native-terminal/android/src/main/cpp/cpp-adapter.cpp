// JNI bridge for the single package .so:
//  1. Render plane: HybridTerminal.kt <-> the Rust render C-ABI (attach/draw/
//     resize/send_input/destroy) in libshim_uniffi.so.
//  2. Control plane install: ReactNativeTerminalModule.nativeInstallRustCrate ->
//     NativeShimUniffi::registerModule (installs globalThis.NativeShimUniffi so the
//     ubrn-generated TS bindings can call the uniffi scaffolding). See docs §8/§10.

#include <android/native_window_jni.h>
#include <cstddef>
#include <cstdint>
#include <jni.h>

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/CallInvokerHolder.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

#include "shim_uniffi.hpp" // generated: NativeShimUniffi::registerModule
#include "ReactNativeTerminalOnLoad.hpp" // generated: registerAllNatives()

namespace jsi = facebook::jsi;
namespace jni = facebook::jni;

// ─────────────────────────── render plane (C-ABI) ───────────────────────────

extern "C" {
void *fressh_terminal_attach(void *window, const char *font_path, float font_size,
                             const char *shell_id);
void fressh_terminal_set_shell(void *handle, const char *shell_id);
void fressh_terminal_set_font_size(void *handle, float font_size);
void fressh_terminal_draw(void *handle);
void fressh_terminal_resize(void *handle);
void fressh_terminal_send_input(void *handle, const uint8_t *data, size_t len);
void fressh_terminal_destroy(void *handle);
}

// Track the ANativeWindow alongside the Rust handle so we can release the window
// reference (taken by ANativeWindow_fromSurface) on teardown.
namespace {
struct TerminalHandle {
  ANativeWindow *window;
  void *rust;
};

const char *orNull(JNIEnv *env, jstring s, const char **owned) {
  if (s == nullptr) {
    *owned = nullptr;
    return nullptr;
  }
  *owned = env->GetStringUTFChars(s, nullptr);
  return *owned;
}
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeAttach(
    JNIEnv *env, jobject /* this */, jobject surface, jstring font_path,
    jfloat font_size, jstring shell_id) {
  ANativeWindow *window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) {
    return 0;
  }

  const char *fontOwned = nullptr;
  const char *shellOwned = nullptr;
  const char *font = orNull(env, font_path, &fontOwned);
  const char *shell = orNull(env, shell_id, &shellOwned);

  void *rust = fressh_terminal_attach(window, font, font_size, shell);

  if (fontOwned) env->ReleaseStringUTFChars(font_path, fontOwned);
  if (shellOwned) env->ReleaseStringUTFChars(shell_id, shellOwned);

  if (rust == nullptr) {
    ANativeWindow_release(window);
    return 0;
  }
  auto *handle = new TerminalHandle{window, rust};
  return reinterpret_cast<jlong>(handle);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeSetShell(
    JNIEnv *env, jobject /* this */, jlong handle, jstring shell_id) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h == nullptr) return;
  const char *owned = nullptr;
  const char *shell = orNull(env, shell_id, &owned);
  fressh_terminal_set_shell(h->rust, shell);
  if (owned) env->ReleaseStringUTFChars(shell_id, owned);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeSetFontSize(
    JNIEnv * /* env */, jobject /* this */, jlong handle, jfloat font_size) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h != nullptr) fressh_terminal_set_font_size(h->rust, font_size);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeDraw(
    JNIEnv * /* env */, jobject /* this */, jlong handle) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h != nullptr) fressh_terminal_draw(h->rust);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeResize(
    JNIEnv * /* env */, jobject /* this */, jlong handle) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h != nullptr) fressh_terminal_resize(h->rust);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_fressh_HybridTerminal_nativeSendInput(
    JNIEnv *env, jobject /* this */, jlong handle, jbyteArray data) {
  auto *h = reinterpret_cast<TerminalHandle *>(handle);
  if (h == nullptr || data == nullptr) return;
  const jsize len = env->GetArrayLength(data);
  if (len <= 0) return;
  jbyte *bytes = env->GetByteArrayElements(data, nullptr);
  fressh_terminal_send_input(h->rust, reinterpret_cast<const uint8_t *>(bytes),
                             static_cast<size_t>(len));
  env->ReleaseByteArrayElements(data, bytes, JNI_ABORT);
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

// ─────────────────────────── control plane install ───────────────────────────

extern "C" JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_fressh_ReactNativeTerminalModule_nativeInstallRustCrate(
    JNIEnv * /* env */, jobject /* this */, jlong jsiRuntimePtr,
    jobject callInvokerHolderJavaObj) {
  if (jsiRuntimePtr == 0 || callInvokerHolderJavaObj == nullptr) {
    return JNI_FALSE;
  }
  // RN 0.85 removed CallInvokerHolderImpl.mHybridData; reach the C++ instance via
  // fbjni cthis() instead of the (gone) field.
  using JCallInvokerHolder = facebook::react::CallInvokerHolder;
  auto holderLocal = jni::make_local(callInvokerHolderJavaObj);
  auto holderRef =
      jni::static_ref_cast<JCallInvokerHolder::javaobject>(holderLocal);
  auto *holderCxx = holderRef->cthis();
  std::shared_ptr<facebook::react::CallInvoker> jsCallInvoker =
      holderCxx->getCallInvoker();

  auto *runtime = reinterpret_cast<jsi::Runtime *>(jsiRuntimePtr);
  NativeShimUniffi::registerModule(*runtime, jsCallInvoker);
  return JNI_TRUE;
}

// ─────────────────────────── Nitro view registration ───────────────────────────

// Nitro registers the "Terminal" Fabric component descriptor (plus the HybridObject
// constructor and the fbjni natives) in registerAllNatives(). It MUST run from this
// library's JNI_OnLoad — without it, Fabric never learns about the "Terminal"
// component and falls back to legacy ViewManager interop, which creates the view but
// silently drops every prop (so `shellId` never reaches HybridTerminal and the
// renderer draws an unbound/black frame). See ReactNativeTerminalOnLoad.hpp.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void * /* reserved */) {
  return facebook::jni::initialize(
      vm, [] { margelo::nitro::fressh::registerAllNatives(); });
}
