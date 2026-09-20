import 'dart:async';
import 'package:flutter/material.dart';
import '../services/profile_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, this.service});
  final ProfileService? service;
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final _service = widget.service ?? ProfileService();
  final _name = TextEditingController();
  final _form = GlobalKey<FormState>();
  UserProfile? _profile;
  String _voice = 'delia';
  bool _loading = true, _saving = false, _saved = false;
  String? _error;
  bool get _dirty => _profile != null && (_name.text.trim() != _profile!.displayName || _voice != _profile!.voiceKey);

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final value = await _service.load();
      if (!mounted) return;
      setState(() {
        _profile = value;
        _name.text = value.displayName;
        _voice = value.voiceKey;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Unable to load your profile. Please try again.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _save() async {
    if (_saving || !_dirty || !_form.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
      _saved = false;
    });
    try {
      final patch = <String, String>{};
      if (_name.text.trim() != _profile!.displayName) patch['displayName'] = _name.text.trim();
      if (_voice != _profile!.voiceKey) patch['voiceKey'] = _voice;
      final value = await _service.update(patch);
      if (!mounted) return;
      setState(() {
        _profile = value;
        _name.text = value.displayName;
        _voice = value.voiceKey;
        _saved = true;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Your changes could not be saved. Please try again.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
        });
      }
    }
  }

  Future<void> _back() async {
    if (_saving) return;
    if (_dirty) {
      final discard = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
                title: const Text('Discard changes?'),
                content: const Text('Your profile changes have not been saved.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep editing')),
                  TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Discard')),
                ],
              ));
      if (discard != true || !mounted) return;
      setState(() {
        _name.text = _profile!.displayName;
        _voice = _profile!.voiceKey;
      });
      // Let PopScope accept the navigation after discarding changes.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.pop(context);
      });
    } else {
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: !_dirty && !_saving,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) unawaited(_back());
        },
        child: Scaffold(
          appBar: AppBar(
              title: const Text('Profile / Settings'),
              leading: IconButton(
                  tooltip: 'Back to Diana', icon: const Icon(Icons.arrow_back), onPressed: _saving ? null : _back)),
          body: SafeArea(
              child: Center(
                  child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 600),
                      child: ListView(
                        padding: const EdgeInsets.all(24),
                        children: [
                          if (_loading)
                            const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your profile')),
                          if (_error != null && _profile == null)
                            Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: Semantics(
                                    liveRegion: true,
                                    child:
                                        Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)))),
                          if (!_loading && _profile == null) FilledButton(onPressed: _load, child: const Text('Retry')),
                          if (_profile != null)
                            Form(
                                key: _form,
                                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                                  const Text('Email', style: TextStyle(fontWeight: FontWeight.bold)),
                                  Text(_profile!.email.isEmpty ? 'Not provided' : _profile!.email),
                                  const Text('Managed by your sign-in account.', style: TextStyle(fontSize: 14)),
                                  const SizedBox(height: 24),
                                  TextFormField(
                                      controller: _name,
                                      enabled: !_saving,
                                      maxLength: 100,
                                      decoration: const InputDecoration(labelText: 'Display name'),
                                      onChanged: (_) => setState(() {
                                            _saved = false;
                                          }),
                                      validator: (value) =>
                                          (value?.length ?? 0) > 100 || RegExp(r'[\x00-\x1f\x7f]').hasMatch(value ?? '')
                                              ? 'Use up to 100 characters without control characters.'
                                              : null),
                                  const SizedBox(height: 24),
                                  DropdownButtonFormField<String>(
                                      initialValue: _voice,
                                      isExpanded: true,
                                      decoration: const InputDecoration(labelText: 'Preferred voice'),
                                      items: [
                                        if (!profileVoices.containsKey(_voice))
                                          DropdownMenuItem(value: _voice, child: const Text('Previously saved voice')),
                                        ...profileVoices.entries.map(
                                            (voice) => DropdownMenuItem(value: voice.key, child: Text(voice.value))),
                                      ],
                                      onChanged: _saving
                                          ? null
                                          : (value) => setState(() {
                                                _voice = value!;
                                                _saved = false;
                                              })),
                                  const SizedBox(height: 12),
                                  const Text(
                                      'This saves your preference. Changing Diana’s speaking voice is not available yet.',
                                      style: TextStyle(fontSize: 14)),
                                  const SizedBox(height: 24),
                                  const Text('Plan', style: TextStyle(fontWeight: FontWeight.bold)),
                                  Text('${_profile!.planId} · ${_profile!.status}'),
                                  const SizedBox(height: 24),
                                  FilledButton(
                                      onPressed: _saving || !_dirty ? null : _save,
                                      child: Text(_saving ? 'Saving…' : 'Save changes')),
                                  if (_error != null)
                                    Padding(
                                        padding: const EdgeInsets.only(top: 16),
                                        child: Semantics(
                                            liveRegion: true,
                                            child: Text(_error!,
                                                style: TextStyle(color: Theme.of(context).colorScheme.error)))),
                                  if (_saved)
                                    Padding(
                                        padding: const EdgeInsets.only(top: 16),
                                        child: Semantics(liveRegion: true, child: const Text('Profile saved.'))),
                                ])),
                        ],
                      )))),
        ),
      );
}
