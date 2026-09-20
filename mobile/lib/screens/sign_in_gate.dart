import 'package:flutter/material.dart';
import '../services/cognito_auth.dart';

class SignInGate extends StatelessWidget {
  const SignInGate({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: cognitoAuth,
        builder: (context, _) {
          if (cognitoAuth.signedIn) return child;
          return Scaffold(
              body: Center(
                  child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('Diana', style: Theme.of(context).textTheme.headlineLarge),
              const SizedBox(height: 24),
              const Text('Sign in to start your conversation.'),
              if (cognitoAuth.error != null)
                Padding(padding: const EdgeInsets.all(16), child: Text(cognitoAuth.error!)),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: cognitoAuth.busy ? null : cognitoAuth.signIn,
                child: Text(cognitoAuth.busy ? 'Signing in…' : 'Sign in'),
              ),
            ]),
          )));
        },
      );
}
