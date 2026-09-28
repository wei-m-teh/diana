import 'package:flutter/material.dart';

class LocationSettings extends StatelessWidget {
  const LocationSettings(
      {super.key,
      required this.mode,
      required this.city,
      required this.disabled,
      required this.onChanged,
      required this.onCheck,
      this.status,
      this.lastKnown});
  final String mode, city;
  final bool disabled;
  final void Function(String, String) onChanged;
  final VoidCallback onCheck;
  final String? status;
  final Map<String, dynamic>? lastKnown;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Location', style: TextStyle(fontWeight: FontWeight.bold)),
        DropdownButtonFormField<String>(
          key: ValueKey('location-$mode'),
          initialValue: mode,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Share location with Diana'),
          items: const [
            DropdownMenuItem(value: 'off', child: Text('Off — clear saved location')),
            DropdownMenuItem(value: 'device', child: Text('Use device location')),
            DropdownMenuItem(value: 'manual', child: Text('Use a city I enter'))
          ],
          onChanged: disabled
              ? null
              : (value) {
                  onChanged(value!, city);
                  if (value == 'device' && mode != 'device') onCheck();
                },
        ),
        if (mode == 'manual')
          TextFormField(
              initialValue: city,
              enabled: !disabled,
              maxLength: 120,
              decoration:
                  const InputDecoration(labelText: 'City, region and country', hintText: 'Seattle, Washington, USA'),
              onChanged: (value) => onChanged(mode, value),
              validator: (value) => value == null ||
                      value.trim().isEmpty ||
                      value.length > 120 ||
                      RegExp(r'[\x00-\x1f\x7f]').hasMatch(value)
                  ? 'Enter a city, region and country (up to 120 characters).'
                  : null),
        if (mode == 'device')
          OutlinedButton(
              onPressed: disabled ? null : onCheck, child: const Text('Allow / check location on this device')),
        if (status != null) Semantics(liveRegion: true, child: Text(status!)),
        const Text(
            'Device mode checks your approximate location when each conversation starts. Your last location and its time are saved to your account for future conversations if a new location is unavailable. Allow access on each device. No continuous tracking.'),
        if (lastKnown != null)
          Text(
              'Last saved: ${lastKnown!["city"] ?? "Approximate location"} · ${DateTime.tryParse(lastKnown!["capturedAt"] ?? "")?.toLocal() ?? "Unknown time"}'),
        const SizedBox(height: 8),
        const Text(
            'Save changes to apply on web and Android, starting with your next conversation. Turning sharing off clears the saved fix; it cannot remove location already shared in an active conversation.'),
      ]);
}
