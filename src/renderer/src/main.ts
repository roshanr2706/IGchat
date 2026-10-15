import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { initialCustomThemes, initialSettings } from './lib/api';
import { settings } from './stores/settings.svelte';
import { themes } from './stores/themes.svelte';
import { applyTheme } from './themes/apply';

// Apply the saved theme synchronously, before the first paint, so there is no flash.
settings.init(initialSettings());
themes.seedCustom(initialCustomThemes());
themes.prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(document.documentElement, themes.active, settings.value.accent);
document.documentElement.style.setProperty('--font-scale', String(settings.value.fontScale));

mount(App, { target: document.getElementById('app')! });
