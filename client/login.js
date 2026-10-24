'use strict';
document.addEventListener('DOMContentLoaded', () => {
    let mode = 'login';
    const $ = id => document.getElementById(id);
    function setMode(value) {
        mode = value;
        $('tab-login').classList.toggle('active', mode === 'login');
        $('tab-register').classList.toggle('active', mode === 'register');
        $('password2-input').classList.toggle('hidden', mode === 'login');
        $('auth-button').textContent = mode === 'login' ? '登录' : '注册';
        $('auth-error').textContent = '';
    }
    $('tab-login').onclick = () => setMode('login'); $('tab-register').onclick = () => setMode('register');
    async function submit() {
        const username = $('username-input').value.trim(), password = $('password-input').value;
        if (mode === 'register' && password !== $('password2-input').value) { $('auth-error').textContent = '两次输入的密码不一致'; return; }
        $('auth-button').disabled = true;
        try {
            const response = await fetch('/api/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            localStorage.removeItem('lantalk_auth'); sessionStorage.removeItem('lantalk_auth');
            const store = $('remember-me').checked ? localStorage : sessionStorage;
            store.setItem('lantalk_auth', JSON.stringify({ token: data.token, username: data.username, role: data.role, origin: location.origin }));
            location.replace('/chat');
        } catch (error) { $('auth-error').textContent = error.message; }
        finally { $('auth-button').disabled = false; }
    }
    $('auth-button').onclick = submit;
    for (const id of ['username-input', 'password-input', 'password2-input']) $('' + id).onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) submit(); };
    // Restore older saved sessions by setting the HttpOnly session cookie through /api/me.
    (async () => {
        try {
            const raw = localStorage.getItem('lantalk_auth') || sessionStorage.getItem('lantalk_auth');
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.origin !== location.origin || !saved.token) return;
            const response = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + saved.token } });
            if (response.ok) location.replace('/chat');
        } catch {}
    })();
});
