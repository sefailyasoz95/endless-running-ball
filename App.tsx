import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import BallRunnerGame from "./BallRunnerGame";

export default function App() {
  return <BallRunnerGame />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
