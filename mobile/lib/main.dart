import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'app.dart';
import 'services/cognito_auth.dart';

// Load environment variables before starting the app
// This is used to configure the LiveKit sandbox ID for development
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');
  await cognitoAuth.restore();
  runApp(const VoiceAssistantApp());
}
